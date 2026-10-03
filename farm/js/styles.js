// 六种风格：A-C 偏水墨，D-F 偏科技
export const STYLES = {
  A: {
    name: 'A 水墨淡彩', desc: '贴近视频：白纸地面、灰墨湖水、黑瓦白墙、红色竖幡',
    sky: ['#eef0ec', '#dfe7e4'], fog: '#e7ebe6', fogNear: 200, fogFar: 680,
    land: '#eef0ea', land2: '#e2e8e2', slope: '#a9c2ba', mountain: '#7fa29b', peak: '#dfe7e3', sand: '#efeadb',
    bank: '#cfd9d3', grass: '#dde6da', field: '#b8c9a8', ridge: '#93ad86', soil: '#d3c8b6',
    water: '#5d656f', waterDeep: '#4b525b', waterLine: '#8d97a1', foam: '#f6f6f2',
    roof: '#3a3c40', wall: '#f3f2ec', wood: '#6b5d55', blossom: '#e9a9b6', palm: '#6e8c7b', trunk: '#7a6c62', tree: '#8aa196',
    accent: '#c8382f', line: '#2a2d31', lineStrength: 0.85, lineWidth: 1.0, wobble: 1.0,
    paper: 0.55, bloom: 0, light: 1.0, ambient: 1.55, shadow: 0.25, grid: 0, banner: 'ink',
  },
  B: {
    name: 'B 水墨 × 科技', desc: '水墨底子，地块描青色光边，地面有淡淡的网格线',
    sky: ['#eef1f0', '#d6e3e4'], fog: '#e3eaea', fogNear: 200, fogFar: 680,
    land: '#eef0ec', land2: '#e1e8e5', slope: '#a3c1bd', mountain: '#7a9fa0', peak: '#e2eaea', sand: '#eeeadc',
    bank: '#cbd8d6', grass: '#dbe5df', field: '#b5c8ab', ridge: '#8eab88', soil: '#d0c6b6',
    water: '#56606c', waterDeep: '#454e59', waterLine: '#6fd3e6', foam: '#f4fbfc',
    roof: '#373a40', wall: '#f3f2ee', wood: '#665a54', blossom: '#e7a5b5', palm: '#6a8c80', trunk: '#776a62', tree: '#87a19a',
    accent: '#00b8d9', line: '#283036', lineStrength: 0.8, lineWidth: 1.0, wobble: 0.6,
    paper: 0.4, bloom: 0.6, bloomThreshold: 1.0, light: 1.0, ambient: 1.5, shadow: 0.25, grid: 0.35, plotGlow: '#18d6f0', banner: 'inktech',
  },
  C: {
    name: 'C 夜墨赛博', desc: '夜晚的水墨城，青色线条发光，湖面霓虹波纹',
    sky: ['#0a1322', '#152a3d'], fog: '#0d1b2b', fogNear: 200, fogFar: 680,
    land: '#1a2532', land2: '#1e2b3a', slope: '#1f3443', mountain: '#18293a', peak: '#2c4658', sand: '#2b3644',
    bank: '#223140', grass: '#1c2a36', field: '#1c3a31', ridge: '#25503f', soil: '#2c2a2a',
    water: '#060b14', waterDeep: '#04070d', waterLine: '#16d9ff', foam: '#8ff4ff',
    roof: '#10141a', wall: '#2c3946', wood: '#3a3030', blossom: '#ff4fa3', palm: '#1d5a4c', trunk: '#3c3434', tree: '#1f4440',
    accent: '#ff3b6b', line: '#3fe6ff', lineStrength: 0.6, lineWidth: 1.0, wobble: 0.2, lineGlow: true,
    paper: 0.1, bloom: 0.55, light: 0.55, ambient: 0.9, shadow: 0.35, grid: 0.5, plotGlow: '#2cff9a', grid2: 1, windows: '#ffcf6b', banner: 'neon',
  },
  D: {
    name: 'D 青绿山水', desc: '《千里江山图》的石青石绿，金线点缀，暖色绢底',
    sky: ['#f3e9d0', '#e4d5b0'], fog: '#efe3c6', fogNear: 200, fogFar: 680,
    land: '#ece0c2', land2: '#e2d5b0', slope: '#5aa38f', mountain: '#2f8a80', peak: '#3c6f9e', sand: '#f1e4c3',
    bank: '#d4cba3', grass: '#d7d4a6', field: '#a7bf80', ridge: '#7fa064', soil: '#d2bb94',
    water: '#8fb6b5', waterDeep: '#6f9d9f', waterLine: '#e9f1e6', foam: '#fbf6e8',
    roof: '#4a4542', wall: '#f5edd6', wood: '#7a5a42', blossom: '#e98f8a', palm: '#4f8c6c', trunk: '#7a5f4a', tree: '#4f8f75',
    accent: '#b8862e', line: '#3a2f25', lineStrength: 0.8, lineWidth: 1.0, wobble: 0.8,
    paper: 0.75, bloom: 0, light: 1.0, ambient: 1.45, shadow: 0.3, grid: 0, banner: 'gold', pine: '#2f7563',
  },
  E: {
    name: 'E 全息沙盘', desc: '数字孪生沙盘：单色蓝调模型、发光描边、扫描网格',
    sky: ['#06121f', '#0f2a40'], fog: '#0a1d30', fogNear: 200, fogFar: 680,
    land: '#22405a', land2: '#264763', slope: '#2c5373', mountain: '#2a4d6c', peak: '#3d6a90', sand: '#2f5070',
    bank: '#2a4b66', grass: '#24445e', field: '#1f5c6a', ridge: '#2a7a86', soil: '#2a465c',
    water: '#08182a', waterDeep: '#051120', waterLine: '#59c8ff', foam: '#a8e6ff',
    roof: '#3f6588', wall: '#6a90b2', wood: '#365470', blossom: '#7fd8ff', palm: '#2f6f80', trunk: '#36546e', tree: '#2f6578',
    accent: '#38e0ff', line: '#86eaff', lineStrength: 0.6, lineWidth: 1.0, wobble: 0, lineGlow: true,
    paper: 0, bloom: 0.5, light: 0.8, ambient: 1.1, shadow: 0.2, grid: 0.8, plotGlow: '#38e0ff', scan: true, banner: 'holo',
  },
  F: {
    name: 'F 卡通描边', desc: '明快卡通 + 深色描边，像手游地图，顶上加科技感标签',
    sky: ['#8fd0f2', '#d9f1fb'], fog: '#cfeaf5', fogNear: 200, fogFar: 680,
    land: '#a5d46c', land2: '#b8dc78', slope: '#7fb85e', mountain: '#5c9c58', peak: '#eef4f2', sand: '#f4e2a8',
    bank: '#93c463', grass: '#9fd06a', field: '#6cb84e', ridge: '#4f9a3c', soil: '#b78659',
    water: '#3aa7dc', waterDeep: '#2b86c0', waterLine: '#c4ecff', foam: '#ffffff',
    roof: '#c9533f', wall: '#fff3dc', wood: '#8a5a3c', blossom: '#ff9cc0', palm: '#3e9b4b', trunk: '#946a48', tree: '#4ea24e',
    accent: '#ff7a3d', line: '#2a2320', lineStrength: 0.9, lineWidth: 1.0, wobble: 0,
    paper: 0, bloom: 0, light: 1.15, ambient: 1.3, shadow: 0.45, grid: 0, banner: 'cartoon',
  },
};

// 青绿山水 + 科技（候选 H1-H4）
STYLES.H1 = {
  ...STYLES.D, land2: '#d9dcaa', meadow: '#cfd69a', name: 'H1 青绿 · 青光', desc: '青绿山水 + 青色网格，青玉玻璃标牌带光柱',
  accent: '#1fb8a8', grid: 0.25, banner: 'jadetech', paper: 0.6, fogNear: 420, fogFar: 1250,
};
STYLES.H2 = {
  ...STYLES.D, land2: '#d9dcaa', meadow: '#cfd69a', name: 'H2 青绿 · 金线', desc: '青绿山水 + 淡金网格，石青标牌金框，更古典',
  accent: '#c9a34a', grid: 0.22, banner: 'goldtech', paper: 0.6, fogNear: 420, fogFar: 1250,
};
STYLES.H3 = {
  ...STYLES.D, meadow: '#3f5a46', name: 'H3 青绿 · 夜景', desc: '入夜的青绿山水：屋里亮灯、湖面青光、网格微微发光',
  sky: ['#0d1a2b', '#26465c'], fog: '#18303f', fogNear: 420, fogFar: 1250,
  land: '#4a5852', land2: '#46544f', slope: '#2d6660', mountain: '#1f4f4c', peak: '#2e5f7a', sand: '#5b5f55',
  bank: '#3c4a46', grass: '#40524a', field: '#3f7a52', ridge: '#2f6343', soil: '#5a5045',
  water: '#123241', waterDeep: '#0c2430', waterLine: '#3fe0d0', foam: '#a8f3ea',
  roof: '#1a1d22', wall: '#b9b29c', wood: '#5a4636', blossom: '#e07a8a', palm: '#2f6b55', trunk: '#4c3a30', tree: '#2c6052', pine: '#244f45',
  accent: '#2fe0cf', line: '#0a1216', lineStrength: 0.75, paper: 0.25, light: 0.55, ambient: 0.95, shadow: 0.35,
  grid: 0.35, windows: '#ffcf6b', lanterns: '#ff7a4a', bloom: 0.7, bloomThreshold: 0.9, banner: 'jadetech',
};
STYLES.H4 = {
  ...STYLES.D, land2: '#d9dcaa', meadow: '#cfd69a', name: 'H4 青绿 · 白描朱印', desc: '更淡雅：浅青绿 + 墨线 + 朱红印章标牌，青色数据条',
  land: '#f2ead6', land2: '#ebe2ca', slope: '#86b8a6', mountain: '#5a9e92', peak: '#6f93b5', grass: '#e2dfbf',
  field: '#9fbf86', ridge: '#7da36a', water: '#a9c9c4', waterDeep: '#8db7b3', paper: 0.85, wobble: 1.0,
  accent: '#3bbfb0', grid: 0.14, banner: 'sealtech', fogNear: 420, fogFar: 1250,
};
