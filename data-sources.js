/* 数据来源与隐私说明：AI收成预测用到的全部出处集中在这里，只在“账号管理”（平台管理员）里展开查看。
 * 收成预测页面和小程序本身不再显示出处。参数来源表直接读取 harvest-model.js 的 PARAMETERS。 */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text || href)}</a>`;

  const PRIVACY = [
    '网页版收成预测：浏览器直接向 Open-Meteo 历史天气接口请求所选地点的逐日天气，请求里带有该点经纬度；不发送账号或地块名称。',
    '小程序收成预测：由本平台服务器代为请求天气，按“地点＋年份”保存在本平台数据库中以减少重复请求；小程序通过微信云托管转发到本平台服务器。',
    '土壤数据：保存在本平台服务器上的离线数据集中查询，查询不经过第三方。',
    '地图：网页地图底图由高德地图提供，浏览器会向高德请求当前视野内的地图图片。',
    '“导出完整分析”“导出实收记录”生成的文件只保存在使用者自己的电脑上，不上传到本平台数据库。',
    '小程序微信登录只用于识别账号（openid），不读取昵称、头像或手机号。'
  ];

  const SOURCES = [
    { name: '历史逐日天气', text: 'Open-Meteo Historical Weather API，ERA5 再分析数据（逐日气温、降水、参考蒸散、短波辐射）', href: 'https://open-meteo.com/en/docs/historical-weather-api' },
    { name: '国内土壤背景值', text: '国家青藏高原科学数据中心，戴永久、上官微《面向陆面模拟的中国土壤数据集》，约1km，表层；须引用 Shangguan et al. (2013), A China Dataset of Soil Properties for Land Surface Modeling, doi:10.1002/jame.20026', href: 'https://doi.org/10.11888/Soil.tpdc.270281' },
    { name: '地图底图', text: '高德地图（网页版）；小程序选点使用微信位置选择', href: 'https://lbs.amap.com/' },
    { name: '肥料参考价', text: '生意社 2026年9月11日化肥基准价（尿素、复合肥15-15-15、硫酸钾、氯化钾）', href: 'https://news.qq.com/rain/a/20260911A0ASP600' },
    { name: '红薯常用施肥', text: '广西农业农村厅农技知识库：基肥硫酸钾型复合肥 50–75 kg/亩，膨大期追硫酸钾 10–15 kg/亩；红薯忌氯', href: 'http://nynct.gxzf.gov.cn/hdjl/znwd/njzsk/t11393538.shtml' },
    { name: '木薯常用施肥', text: '广西农业农村厅《木薯栽培技术》：尿素约 25 kg、三元复合肥约 60 kg、氯化钾约 15 kg/亩', href: 'http://nynct.gxzf.gov.cn/gxtf/xwdt_85167/tfjs/t5400138.shtml' }
  ];

  const METHOD = '逐日计算：日间逐时温度决定温度响应，冠层叶面积截获光合有效辐射，乘以光能利用效率得到干物质，再按生育进度分配到叶、茎和块根。水分按FAO-56简化水量平衡，含有限排水、田间持水量以上的暂存水和地表积水；持续过湿才降低生长。冷害、冻害和高温暴露分开统计。最后用QUEFTS计算N/P/K限制，按商品率、售价和成本比较收益。生长模块为简化的光能利用（LINTUL式）Beta实现，不是完整LINTUL。';

  const REFERENCES = [
    { text: 'LINTUL-2（瓦赫宁根大学）：简单作物生长模型，潜在与水分限制条件', href: 'https://models.pps.wur.nl/lintul-2-simple-crop-growth-model-both-potential-and-water-limited-growing-conditions' },
    { text: 'FAO-56（Allen et al. 1998）：作物蒸散与水量平衡', href: 'https://www.fao.org/4/X0490E/x0490e0e.htm' },
    { text: 'AKILIMO QUEFTS（IITA）：养分限制计算，本平台移植自其 R 实现', href: 'https://github.com/IITA-AKILIMO/akilimo-recommendations' },
    { text: 'FAO EcoCrop：甘薯（Ipomoea batatas）温度与产量量级', href: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=1265' },
    { text: 'Kumar et al. 2016, Application of QUEFTS Model for Site-Specific Nutrient Management of NPK in Sweet Potato（红薯养分参数）', href: 'https://doi.org/10.1080/00103624.2016.1194989' }
  ];

  function parameterTables() {
    const M = window.HarvestModel;
    if (!M || !M.PARAMETERS) return '<p class="ds-hint">参数表需要 harvest-model.js，当前页面未加载。</p>';
    const show = v => Array.isArray(v) ? v.map(x => Array.isArray(x) ? '[' + x.join(', ') + ']' : x).join(', ') : typeof v === 'object' && v !== null ? Object.entries(v).map(([k, x]) => k + '=' + x).join(', ') : String(v);
    const table = (title, entries) => `<h4>${esc(title)}</h4><div class="ds-table-wrap"><table class="data-table"><thead><tr><th>参数</th><th>数值</th><th>单位</th><th>可信度</th><th>适用</th><th>来源</th></tr></thead><tbody>${entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(show(v.value))}</td><td>${esc(v.unit)}</td><td>${esc(v.confidence)}</td><td>${esc(v.scope)}</td><td>${esc(v.source)}${v.note ? ' · ' + esc(v.note) : ''}</td></tr>`).join('')}</tbody></table></div>`;
    const crops = M.crops || {};
    return Object.keys(M.PARAMETERS).map(key => {
      const label = key === 'shared' ? '通用参数' : (crops[key] && crops[key].name ? crops[key].name : key) + ' 参数';
      const note = crops[key] && crops[key].parameterSource ? `<p class="ds-hint">${esc(crops[key].parameterSource)}</p>` : '';
      return table(label, Object.entries(M.PARAMETERS[key])) + note;
    }).join('') + `<p class="ds-hint">模型版本 ${esc(M.VERSION || '')}</p>`;
  }

  function render() {
    return `<section><h4>隐私说明</h4><ul>${PRIVACY.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
      <section><h4>数据来源</h4><ul>${SOURCES.map(s => `<li><b>${esc(s.name)}</b>：${esc(s.text)}（${link(s.href, '来源')}）</li>`).join('')}</ul></section>
      <section><h4>模型方法与参考文献</h4><p>${esc(METHOD)}</p><ul>${REFERENCES.map(r => `<li>${link(r.href, r.text)}</li>`).join('')}</ul></section>
      <section><h4>参数来源表</h4>${parameterTables()}</section>`;
  }

  // Filled on first open, so the accounts page loads nothing extra until an admin asks for it.
  function mount() {
    const box = document.getElementById('data-sources');
    const body = document.getElementById('data-sources-body');
    if (!box || !body) return;
    box.addEventListener('toggle', () => {
      if (!box.open || body.dataset.ready) return;
      // The accounts page is admin-only already; keep the notes closed to anyone else regardless.
      // app.js declares `const app` (a global binding, not a window property).
      if (typeof app !== 'undefined' && typeof app.canManageUsers === 'function' && !app.canManageUsers()) {
        body.innerHTML = '<p class="ds-hint">仅平台管理员可查看。</p>';
        return;
      }
      body.innerHTML = render();
      body.dataset.ready = '1';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
