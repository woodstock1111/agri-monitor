
const fs = require('fs');
const path = require('path');

const mojibakeMap = {
    '鏅烘収': '智慧',
    '鍐滀笟': '农业',
    '鐩戞祴': '监测',
    '骞冲彴': '平台',
    '鐧诲綍': '登录',
    '澶辫触': '失败',
    '璇锋眰': '请求',
    '娓╁害': '温度',
    '婀垮害': '湿度',
    '鏁版嵁': '数据',
    '鍦ㄧ嚎': '在线',
    '鏆傛棤': '暂无',
    '鏈湴': '本地',
    '妯″紡': '模式',
    '娣峰悎': '混合',
    '鍚庣': '后端',
    '璁惧': '设备',
    '缂哄皯': '缺少',
    '璇嗗埆': '识别',
    '閰嶇疆': '配置',
    '璁よ瘉': '认证',
    '浜戠': '云端',
    '璇峰湪涓婃柟閫夋嫨': '请在上方选择',
    '浠ユ煡鐪嬪疄鏃舵暟鎹?': '以查看实时数据',
    '鈹€鈹€鈹€': '---',
    '閻ц缍': '登录',
    '骞冲彴绠＄悊鍛': '平台管理员',
    '瀹㈡埛绠＄悊鍛': '客户管理员',
    '馃彿锔?': '📍',
    '馃椇锔?': '🌍',
    '鑱氱劍姝ゅ湴鍧?': '聚焦此地块',
    '鏍囧噯鍥?': '标准图',
    '鍗槦鍥?': '卫星图',
    '姝ｅ湪杩炴帴鍚庣骞跺悓姝ユ暟鎹?': '正在连接后端并同步数据',
    '鍚庣鍝嶅簲寮傚父': '后端响应异常',
    '杩愯妯″紡鏃犳晥': '运行模式无效',
    '婕旂ず': '演示',
    '鍦板潡': '地块',
    '鏆傚仠璁板綍': '暂停记录',
    '鎭㈠璁板綍': '恢复记录',
    '鏆傛棤璀︽姤锛屼竴鍒囨甯?': '暂无警报，一切正常',
    '鏌ョ湅': '查看',
    '璇ュ湪绾胯澶囨湭鍏宠仈浜戠鍙傛暟锛岃鍒犻櫎鍚庨€氳繃鈥滆繛鎺ヤ紶鎰熷櫒鈥濋噸鏂板鍏ャ€?': '该在线设备未关联云端参数，请删除后通过“连接传感器”重新导入。',
    '浜?': '亩',
    '鏈厤缃瘑鍒爜': '未配置识别码',
    '鑷姩鍖栬鍒欏凡淇濆瓨': '自动化规则已保存',
    '缂哄皯鏈湴鍘嗗彶璁板綍锛岃鐐嚮涓婃柟鎸夐挳琛ュ厖浜戠鏁版嵁': '暂无本地历史记录，请点击上方按钮补充云端数据',
    '鍥惧眰鍒囨崲鎺т欢': 'Map layer switch control',
    '鏈煡': '未知',
    '鏈厤缃?': '未配置',
    '鐧诲綍涓?': '登录中',
    '鐧诲綍宸插崌鏈燂紝璇烽噸鏂扮櫥褰?': '登录已过期，请重新登录',
    '馃椇锔?鍏ㄩ儴鍦板潡': '🌍 全部地块',
    '鏈鏌?': '未检查',
    '鏈湴杩愯涓?': '本地运行中',
    '鍚庣鍙繛鎺?': '后端可连接',
    '鍚庣涓嶅彲杈?': '后端不可达',
    '鏈繛鎺?': '未连接',
    '宸茶繛鎺?': '已连接',
    '杩炴帴寮傚父': '连接异常',
    '绯荤粺鎬绘煡': '系统总览',
    '瀹炴椂鏁版嵁': '实时数据',
    '瑙嗛鐩戞帶': '视频监控',
    '鏇茬嚎鍥捐〃': '曲线图表',
    '鍘嗗彶璁板綍': '历史记录',
    '鐥呮ch害鏁版嵁搴?': '病虫害数据库',
    '鑷姩鍖栭€佺▼': '自动化流程',
    '鍦板潡绠＄悊': '地块管理',
    '璁惧绠＄悊': '设备管理',
    '璐﹀彿绠＄悊': '账号管理',
    '鍏朵粬': '其他',
    '鈥?': '--',
    '鍙拌澶?': '台设备',
    '閫€绾?': '离线',
    '鎵€鏈夎澶?': '所有设备',
    '鍦ㄧ嚎': '在线',
    '鏈垎閰?': '未分配',
    '浜?': '亩',
};

const commentTranslations = {
    '鈹€鈹€鈹€ BOOT 鈹€鈹€鈹€': '--- BOOT ---',
    '鈹€鈹€鈹€ DYNAMIC SIDEBAR STATUS 鈹€鈹€鈹€': '--- DYNAMIC SIDEBAR STATUS ---',
    '鈹€鈹€鈹€ NAV 鈹€鈹€鈹€': '--- NAV ---',
    '鈹€鈹€鈹€ ALERTS 鈹€鈹€鈹€': '--- ALERTS ---',
    '鈹€鈹€鈹€ DASHBOARD 鈹€鈹€鈹€': '--- DASHBOARD ---',
    '鈹€鈹€鈹€ REALTIME 鈹€鈹€鈹€': '--- REALTIME ---',
    '鈹€鈹€鈹€ API SENSOR RENDERING 鈹€鈹€鈹€': '--- API SENSOR RENDERING ---',
    '鈹€鈹€鈹€ CLOUD API POLLING 鈹€鈹€鈹€': '--- CLOUD API POLLING ---',
    '鈹€鈹€鈹€ VIDEO 鈹€鈹€鈹€': '--- VIDEO ---',
    '鈹€鈹€鈹€ HISTORY 鈹€鈹€鈹€': '--- HISTORY ---',
    '鈹€鈹€鈹€ PEST DB 鈹€鈹€鈹€': '--- PEST DB ---',
    '鈹€鈹€鈹€ LOCATIONS 鈹€鈹€鈹€': '--- LOCATIONS ---',
    '鈹€鈹€鈹€ DEVICES 鈹€鈹€鈹€': '--- DEVICES ---',
    '鈹€鈹€鈹€ DELETE 鈹€鈹€鈹€': '--- DELETE ---',
    '鈹€鈹€鈹€ MAP PICKERS 鈹€鈹€鈹€': '--- MAP PICKERS ---',
    '鈹€鈹€鈹€ HELPERS 鈹€鈹€鈹€': '--- HELPERS ---',
    '鈹€鈹€鈹€ INIT 鈹€鈹€鈹€': '--- INIT ---',
    '鈹€鈹€鈹€ Automation Editor 鈹€鈹€鈹€': '--- Automation Editor ---',
    '鈹€鈹€鈹€ CLOUD SYNC PAGE 鈹€鈹€鈹€': '--- CLOUD SYNC PAGE ---',
    '鍥惧眰鍒囨崲鎺т欢': 'Map layer switch control',
};

function cleanFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Restore Mojibake based on map
    for (const [key, value] of Object.entries(mojibakeMap)) {
        content = content.split(key).join(value);
    }

    const lines = content.split('\n');
    const processedLines = lines.map(line => {
        // 2. Handle comments (convert to English)
        // Detect // but NOT if it's part of :// (URL)
        const commentIdx = line.indexOf('//');
        if (commentIdx !== -1 && (commentIdx === 0 || line[commentIdx-1] !== ':')) {
            const codePart = line.substring(0, commentIdx);
            let commentPart = line.substring(commentIdx + 2);

            for (const [key, value] of Object.entries(commentTranslations)) {
                commentPart = commentPart.split(key).join(value);
            }
            commentPart = commentPart.replace(/[\u4e00-\u9fa5]|[\u4E00-\u9FFF]/g, ' info ');
            commentPart = commentPart.replace(/[^\x00-\x7F]/g, ' '); 

            return codePart + '//' + commentPart;
        }
        
        if (line.trim().startsWith('/*') || line.trim().startsWith('*')) {
             let comment = line;
             for (const [key, value] of Object.entries(commentTranslations)) {
                comment = comment.split(key).join(value);
            }
            comment = comment.replace(/[^\x00-\x7F]/g, ' ');
            return comment;
        }

        return line;
    });

    content = processedLines.join('\n');

    // 3. Convert all remaining Chinese in UI text to Unicode escapes
    content = content.replace(/[\u4e00-\u9fa5]|[\u4E00-\u9FFF]/g, (match) => {
        return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
    });

    // Final sweep for any remaining non-ASCII (emojis, weird symbols)
    content = content.replace(/[^\x00-\x7F]/g, (match) => {
        return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
    });

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Cleaned ${filePath}`);
}

const files = ['app.js', 'server.js'];
files.forEach(f => {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) {
        cleanFile(p);
    } else {
        console.log(`File not found: ${p}`);
    }
});
