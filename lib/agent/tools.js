'use strict';
// Agent tool registry. Each tool carries the metadata the policy needs:
//   kind  'read' | 'write'   — writes change farm data and are recorded for undo.
//   trust 'own' | 'shared' | 'external' — who wrote what the tool returns:
//         own = the caller's own tenant; shared = other tenants or platform admins (pest library,
//         cross-farm photo samples, AI text derived from images); external = third-party services.
// Implementations reach data only through the injected `deps`, so the agent never touches server internals.

const META = {
    get_sensor_latest: { kind: 'read', trust: 'own' },
    get_sensor_history: { kind: 'read', trust: 'own' },
    get_photo_records: { kind: 'read', trust: 'shared' },
    get_pest_library: { kind: 'read', trust: 'shared' },
    search_pest_library: { kind: 'read', trust: 'shared' },
    identify_pest: { kind: 'read', trust: 'shared' },
    get_weather: { kind: 'read', trust: 'external' },
    get_farm_tasks: { kind: 'read', trust: 'own' },
    get_crops: { kind: 'read', trust: 'own' },
    // Writes AI analysis into a photo record after reading the image itself, so it is both a write and external.
    analyze_photo: { kind: 'write', trust: 'external', undoable: false },
    create_farm_task: { kind: 'write', trust: 'own', undoable: true },
    update_farm_task: { kind: 'write', trust: 'own', undoable: true },
    complete_farm_task: { kind: 'write', trust: 'own', undoable: true },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_FIELDS = ['title', 'date', 'category', 'status', 'completedAt'];
const pickTask = task => Object.fromEntries(TASK_FIELDS.map(k => [k, task[k] ?? null]));

function validDate(value) {
    if (!DATE_RE.test(value)) return false;
    const t = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

function titleMatches(task, expected) {
    const actual = String(task.title || '').trim().toLowerCase();
    const want = String(expected || '').trim().toLowerCase();
    return !!want && (actual.includes(want) || want.includes(actual));
}

function createTools(deps) {
    const {
        readState, canAccessTenantItem, scopedTenantRows, userTenantId, dbTenantId, parseQueryTime, safeId,
        sensorStore, photoStore, pestStore, vision, readPhotoConfig, fetchWeatherData, runPhotoAnnotation,
        readFarmTasks, writeFarmTasks,
    } = deps;

    const DEFS = [
        {
            type: 'function',
            function: {
                name: 'get_sensor_latest',
                description: '获取指定设备最新的传感器读数。返回字段包括 temperature、humidity、moisture 等（具体取决于设备类型）。当用户问"现在温度多少"、"土壤湿度怎么样"时使用。必须传 deviceId，可以从系统概况中的设备列表获取。如果用户没指定设备，根据上下文推断或列出可用设备让用户选择。',
                parameters: {
                    type: 'object',
                    properties: { deviceId: { type: 'string', description: '设备ID，从系统概况的设备列表中获取，格式如 "device_xxxx"' } },
                    required: ['deviceId'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_sensor_history',
                description: '获取指定设备在时间范围内的传感器历史数据。返回数组，每条包含 timestamp 和各传感器字段。最多返回200条。当用户问"最近一周温度变化"、"昨天的数据"时使用。startTime 和 endTime 必须传，格式为 ISO 8601。NEVER 省略时间范围参数，否则会返回全量数据。',
                parameters: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string' },
                        startTime: { type: 'string', description: 'ISO 8601 格式，如 "2026-04-28T00:00:00+08:00"。根据用户描述的时间推算具体值。' },
                        endTime: { type: 'string', description: 'ISO 8601 格式，如 "2026-04-28T00:00:00+08:00"。根据用户描述的时间推算具体值。' },
                    },
                    required: ['deviceId', 'startTime', 'endTime'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_photo_records',
                description: '获取照片记录列表，每条包含 id、cropId、cropName、uploadedAt、createdAt、labels（标注结果）。可选按 cropId 筛选。当用户问"最近拍的照片"、"某个作物的记录"时使用。返回全部记录（按时间倒序），数据量可能较大，回答时只摘要关键信息。',
                parameters: {
                    type: 'object',
                    properties: { cropId: { type: 'string' } },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_pest_library',
                description: '获取病虫害及杂草知识库完整列表。每条包含 key、name、type(pest/disease/weed)、symptoms、control（防治方法）。可选按 type 过滤只看虫害、病害或杂草。当用户问"有哪些常见病害"、"虫害列表"、"杂草列表"时使用。如果用户问某个特定病虫害或杂草的详细信息，优先使用 search_pest_library 按关键词精准搜索。',
                parameters: {
                    type: 'object',
                    properties: { type: { type: 'string', enum: ['pest', 'disease', 'weed'] } },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_weather',
                description: '获取指定坐标的当前天气信息。返回温度、湿度、天气状况、风力等。lat/lng 必须传。如果用户没给坐标，使用系统概况中的农场位置。当用户问"今天天气怎么样"、"会不会下雨"时使用。',
                parameters: {
                    type: 'object',
                    properties: {
                        lat: { type: 'string' },
                        lng: { type: 'string' },
                    },
                    required: ['lat', 'lng'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_farm_tasks',
                description: '查询农事计划任务列表。返回数组，每条包含 id、title、date、category、completed（布尔值，是否已完成）。最多返回50条。当用户提到"今天"、"明天"或具体日期时，必须传 date 参数过滤，NEVER 在用户指定了日期的情况下省略 date 参数。不传 date 则返回全部任务。',
                parameters: {
                    type: 'object',
                    properties: {
                        date: { type: 'string', description: '按日期筛选，格式 YYYY-MM-DD。当用户说"今天的任务"、"明天要做什么"时必须传此参数。用系统概况中的当前时间推算具体日期值。' },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_crops',
                description: '获取当前农场的所有作物列表。每条包含 id、name。当用户问"我种了什么"、"有哪些作物"时使用。也用于获取 cropId 供其他工具（如 get_photo_records）使用。',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: 'analyze_photo',
                description: '对指定照片记录执行 AI 视觉分析标注，识别病虫害。需要传 recordId，必须先通过 get_photo_records 查到目标记录的 id。返回分析结果包含识别到的标签和置信度。注意：此操作会调用外部 AI API，耗时可能较长。NEVER 在用户没有明确要求分析时主动调用。',
                parameters: {
                    type: 'object',
                    properties: { recordId: { type: 'string', description: '照片记录ID，必须先调用 get_photo_records 获取，NEVER 猜测或编造此值。' } },
                    required: ['recordId'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'create_farm_task',
                description: '创建一条农事计划任务。title 必须传，date 必须传。创建成功后返回 {ok:true, task}，task 包含生成的 id。当用户说"帮我加个任务"、"安排明天施肥"时使用。NEVER 自行假设日期——如果用户没明确说日期，问用户。category 建议从常见类型中选：施肥、浇水、打药、除草、采收、观察。',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: '任务标题，简洁描述任务内容，如"给木薯施肥"、"检查番茄病害"' },
                        date: { type: 'string', description: '计划日期，YYYY-MM-DD 格式。必须从用户消息中明确获取，不要自行假设。' },
                        category: { type: 'string', description: '任务分类，建议值：施肥、浇水、打药、除草、采收、观察。如果用户没提到分类，从 title 推断。' },
                    },
                    required: ['title', 'date'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'complete_farm_task',
                description: '标记指定农事任务的完成状态。completed 为 true 时标记为已完成（默认），为 false 时标记为未完成。使用前必须先调用 get_farm_tasks 获取任务列表拿到 id。返回 {ok:true, task} 表示成功。NEVER 猜测或编造 taskId。只操作用户明确指定的任务；如果用户说"浇水"，不要同时操作"除草"等其他任务。',
                parameters: {
                    type: 'object',
                    properties: {
                        taskId: { type: 'string', description: '任务ID，必须通过 get_farm_tasks 查询获得，NEVER 编造。' },
                        completed: { type: 'boolean', description: 'true 标记为已完成（默认），false 标记为未完成。用户说"取消完成"、"标记未完成"、"撤销"时传 false。' },
                        expectedTitle: { type: 'string', description: '用户明确指定的任务标题或关键词，如"浇水"。工具会校验目标任务标题是否匹配，防止误改其他任务。' },
                    },
                    required: ['taskId'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'identify_pest',
                description: '根据照片里的检测区域，在全平台已确认的病虫草样本中做相似图比对，返回每个区域的候选种类（含 confidence 投票占比、名称、症状、防治方法），以及视觉模型的 aiGuess 和用户已确认的种类。用于"这是什么虫"、"该打什么药"。使用前必须先调用 get_photo_records 拿到 recordId；如果区域为空，提示用户先做区域检测。给出打药建议时要说明依据和置信度，置信度低时建议人工确认，NEVER 把候选说成确定结论。',
                parameters: {
                    type: 'object',
                    properties: { recordId: { type: 'string', description: '照片记录ID，必须先调用 get_photo_records 获取，NEVER 猜测或编造此值。' } },
                    required: ['recordId'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'search_pest_library',
                description: '按关键词搜索病虫害及杂草知识库，匹配范围包括名称、症状或识别要点、防治方法。返回匹配的条目数组，每条包含 key、name、type、symptoms、control。当用户问"蚜虫怎么防治"、"叶子发黄是什么病"、"香附子怎么识别"时使用。比 get_pest_library 更精准，优先使用此工具搜索特定条目。',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: '搜索关键词，如"蚜虫"、"叶斑"、"发黄"。支持部分匹配。' },
                        type: { type: 'string', enum: ['pest', 'disease', 'weed'], description: '可选，限定搜索类型' },
                    },
                    required: ['keyword'],
                },
            },
        },
    {
        type: 'function',
        function: {
            name: 'update_farm_task',
            description: '修改一条已有农事任务的标题、日期或分类（只改传入的字段）。使用前必须先调用 get_farm_tasks 拿到 taskId，并传 expectedTitle 校验。不能删除任务。',
            parameters: {
                type: 'object',
                properties: {
                    taskId: { type: 'string', description: '任务ID，必须通过 get_farm_tasks 查询获得，NEVER 编造。' },
                    expectedTitle: { type: 'string', description: '用户指定的任务标题或关键词，用于校验目标任务，防止改错。' },
                    title: { type: 'string', description: '新标题（可选）' },
                    date: { type: 'string', description: '新日期 YYYY-MM-DD（可选）' },
                    category: { type: 'string', description: '新分类（可选）' },
                },
                required: ['taskId', 'expectedTitle'],
            },
        },
    },
    ];

    // Read tools return a JSON string, as the model sees it.
    async function runRead(name, args = {}, user) {
        switch (name) {
            case 'get_sensor_latest': {
                const state = readState();
                const deviceId = String(args.deviceId || '');
                const device = (state.devices || []).find(item => item.id === deviceId && canAccessTenantItem(user, item));
                if (!device) return JSON.stringify({ error: 'device not found' });
                const latest = state.realtimeState?.[deviceId] || state.serverRealtime?.[deviceId] || null;
                return JSON.stringify({ device, latest });
            }
            case 'get_sensor_history': {
                const state = readState();
                const deviceId = String(args.deviceId || '');
                const device = (state.devices || []).find(item => item.id === deviceId && canAccessTenantItem(user, item));
                if (!device) return JSON.stringify({ error: 'device not found' });
                const rows = await sensorStore.deviceHistory({
                    deviceId,
                    tenantId: dbTenantId(user),
                    start: parseQueryTime(args.startTime, NaN),
                    end: parseQueryTime(args.endTime, NaN),
                    limit: 200,
                });
                const readings = rows.map(sensorStore.toReading);
                return JSON.stringify({ deviceId, startTime: args.startTime, endTime: args.endTime, readings });
            }
            case 'get_photo_records': {
                const records = await photoStore.listPhotos({
                    tenantId: dbTenantId(user),
                    cropId: args.cropId ? String(args.cropId) : null,
                    limit: 20,
                });
                // Compact view for the model: full records (weather, sensor snapshots, raw boxes) blow up the context.
                // Species keys are resolved to library names so the model does not invent them.
                const names = Object.fromEntries((await pestStore.list()).map(e => [e.key, e.name]));
                const named = key => (key ? { key, name: names[key] || null } : undefined);
                const speciesOf = labels => {
                    const list = value => (Array.isArray(value) ? value : (value ? [value] : []));
                    const keys = [...list(labels?.pestDetail?.species), ...list(labels?.diseaseDetail?.types), ...list(labels?.weedDetail?.types)];
                    return keys.length ? keys.map(named) : undefined;
                };
                return JSON.stringify({
                    records: records.map(r => ({
                        id: r.id,
                        cropId: r.cropId,
                        cropName: r.cropName,
                        takenAt: r.createdAt || r.uploadedAt,
                        hasIssue: r.hasIssue,
                        visualLabels: r.labels?.visual,
                        confirmedSpecies: speciesOf(r.labels),
                        severity: r.labels?.severity ?? undefined,
                        userNotes: r.userNotes || undefined,
                        farmNotes: r.farmNotes || undefined,
                        detections: Array.isArray(r.aiDetections?.detections)
                            ? r.aiDetections.detections.map(d => ({ label: d.label, confidence: d.confidence, pestGuess: d.pestGuess?.name, species: named(d.libraryKey) }))
                            : undefined,
                        confirmedBoxes: r.annotations.map(a => ({ label: a.label, species: named(a.libraryKey) })),
                        aiAnalysis: r.aiAnalysis ? { possibleCause: r.aiAnalysis.possibleCause, severity: r.aiAnalysis.severity } : undefined,
                    })),
                });
            }
            case 'get_pest_library': {
                const type = String(args.type || '').trim();
                const entries = await pestStore.list(['pest', 'disease', 'weed'].includes(type) ? type : '');
                return JSON.stringify({ entries });
            }
            case 'get_weather': {
                const config = readPhotoConfig();
                const weather = await fetchWeatherData(config.amapKey || config.qweatherKey || '', args.lat, args.lng);
                return JSON.stringify({ weather });
            }
            case 'get_farm_tasks': {
                const date = String(args.date || '').trim();
                let tasks = scopedTenantRows(user, readFarmTasks().tasks || []);
                if (date) tasks = tasks.filter(task => task.date === date);
                tasks = tasks.slice(0, 50).map(task => ({ ...task, completed: task.status === 'done' }));
                return JSON.stringify({ tasks });
            }
            case 'get_crops': {
                const crops = await photoStore.listCrops(dbTenantId(user));
                return JSON.stringify({ crops });
            }
            case 'identify_pest': {
                const recordId = String(args.recordId || '');
                const record = await photoStore.getRecord(recordId, dbTenantId(user));
                if (!record) return JSON.stringify({ error: 'record not found' });
                const regions = await vision.identifyPhoto(recordId);
                const keys = [...new Set(regions.flatMap(r => [r.confirmedKey, ...r.candidates.map(c => c.libraryKey)]).filter(Boolean))];
                const library = Object.fromEntries((await pestStore.getByKeys(keys)).map(e => [e.key, { name: e.name, type: e.type, symptoms: e.symptoms, control: e.control }]));
                return JSON.stringify({
                    recordId,
                    regions: regions.map(r => ({
                        label: r.label,
                        category: r.category,
                        confirmedSpecies: r.confirmedKey ? { key: r.confirmedKey, ...(library[r.confirmedKey] || {}) } : null,
                        aiGuess: r.aiGuess,
                        embedded: r.embedded,
                        candidates: r.candidates.map(c => ({ ...c, ...(library[c.libraryKey] || {}) })),
                    })),
                    note: regions.length
                        ? `候选来自全平台已确认样本的相似度投票（相似度低于 ${vision.MIN_SIMILARITY} 的样本不参与），confidence 为投票占比，samples 为参与投票的样本数，样本少时结论不可靠；candidates 为空表示库里还没有足够相似的已确认样本；embedded=false 表示该区域向量还在生成中。`
                        : '这张照片没有虫/病/草类检测区域，请先做区域检测。',
                });
            }
            case 'analyze_photo': {
                const result = await runPhotoAnnotation(String(args.recordId || ''), user);
                return JSON.stringify(result);
            }
            case 'search_pest_library': {
                const keyword = String(args.keyword || '').trim().toLowerCase();
                if (!keyword) return JSON.stringify({ entries: [] });
                const type = String(args.type || '').trim();
                const entries = await pestStore.search(keyword, ['pest', 'disease', 'weed'].includes(type) ? type : '');
                return JSON.stringify({ keyword, entries });
            }
            default:
                return JSON.stringify({ error: 'Unknown tool' });
        }
    }

    // Write tools return { data, change }. `change` is what the action log needs to undo the write:
    // the task id and its fields before and after.
    async function runWrite(name, args = {}, user) {
        const ft = readFarmTasks();
        if (!Array.isArray(ft.tasks)) ft.tasks = [];
        const findOwn = id => ft.tasks.find(item => item.id === id && canAccessTenantItem(user, item));
        if (name === 'create_farm_task') {
            const title = String(args.title || '').trim().slice(0, 200);
            const date = String(args.date || '').trim();
            if (!title || !validDate(date)) return { data: { error: 'title and a valid date (YYYY-MM-DD) required' } };
            const task = {
                id: safeId('task'), title, category: String(args.category || '').trim().slice(0, 50), type: 'ai', date,
                status: 'pending', completedAt: null, aiReason: null, createdAt: Date.now(), tenantId: userTenantId(user),
            };
            ft.tasks.push(task);
            writeFarmTasks(ft);
            return { data: { ok: true, task }, change: { taskId: task.id, before: null, after: pickTask(task) } };
        }
        if (name === 'update_farm_task' || name === 'complete_farm_task') {
            const task = findOwn(String(args.taskId || '').trim());
            if (!task) return { data: { error: 'task not found' } };
            const expected = String(args.expectedTitle || '').trim();
            if (name === 'update_farm_task' || expected) {
                if (!titleMatches(task, expected)) return { data: { error: 'task title mismatch', expectedTitle: expected, actualTitle: task.title || '' } };
            }
            const before = pickTask(task);
            if (name === 'complete_farm_task') {
                const completed = args.completed !== false;
                task.status = completed ? 'done' : 'pending';
                task.completedAt = completed ? new Date().toISOString() : null;
            } else {
                if (args.title !== undefined) {
                    const title = String(args.title).trim().slice(0, 200);
                    if (!title) return { data: { error: 'title cannot be empty' } };
                    task.title = title;
                }
                if (args.date !== undefined) {
                    const date = String(args.date).trim();
                    if (!validDate(date)) return { data: { error: 'date must be YYYY-MM-DD' } };
                    task.date = date;
                }
                if (args.category !== undefined) task.category = String(args.category).trim().slice(0, 50);
            }
            writeFarmTasks(ft);
            return { data: { ok: true, task }, change: { taskId: task.id, before, after: pickTask(task) } };
        }
        if (name === 'analyze_photo') {
            return { data: await runPhotoAnnotation(String(args.recordId || ''), user) };
        }
        return { data: { error: 'Unknown tool' } };
    }

    // Undo one recorded change if the task still looks exactly as the change left it.
    function revert(change, user) {
        const ft = readFarmTasks();
        if (!Array.isArray(ft.tasks)) ft.tasks = [];
        const index = ft.tasks.findIndex(item => item.id === change.taskId && canAccessTenantItem(user, item));
        if (index < 0) return { ok: false, msg: '任务已不存在，无法撤销' };
        const current = pickTask(ft.tasks[index]);
        if (TASK_FIELDS.some(k => String(current[k] ?? '') !== String(change.after[k] ?? ''))) {
            return { ok: false, msg: '任务之后又被修改过，不能撤销' };
        }
        if (change.before === null) ft.tasks.splice(index, 1);
        else Object.assign(ft.tasks[index], change.before);
        writeFarmTasks(ft);
        return { ok: true, task: change.before === null ? null : ft.tasks[index] };
    }

    return {
        defs: DEFS,
        meta: name => META[name] || null,
        runRead,
        runWrite,
        revert,
    };
}

module.exports = { createTools, META, validDate };
