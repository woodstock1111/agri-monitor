#!/usr/bin/env node
'use strict';
// The mini program cannot require files outside miniprogram/, so it carries a copy of harvest-model.js.
// Run after every model change: node scripts/sync-miniprogram-harvest.js (tests/harvest-miniprogram.test.js checks the copy).
const fs=require('node:fs');
const path=require('node:path');
const HEADER='/* 自动生成：由 scripts/sync-miniprogram-harvest.js 从根目录 harvest-model.js 复制，请勿直接修改。 */\n';
const source=path.join(__dirname,'..','harvest-model.js');
const target=path.join(__dirname,'..','miniprogram','utils','harvest-model.js');
function expected(){return HEADER+fs.readFileSync(source,'utf8');}
if(require.main===module){fs.writeFileSync(target,expected());console.log('已同步',path.relative(process.cwd(),target));}
module.exports={expected,target};
