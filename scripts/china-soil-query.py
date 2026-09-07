#!/usr/bin/env python3
"""Read actual grid cell values; no spatial nearest-valid or national defaults."""
import json, sys
from pathlib import Path
import numpy as np
from netCDF4 import Dataset

FIELDS={'AN':('availableN','碱解氮','mg/kg'), 'AP':('availableP','有效磷','mg/kg'), 'AK':('availableK','速效钾','mg/kg'), 'PH':('ph','pH','pH'), 'BD':('bulkDensity','容重','g/cm³'), 'SOM':('organicMatter','有机质','g/kg')}

def query(directory,lat,lng):
    if not np.isfinite(lat) or not np.isfinite(lng) or not 17.8<=lat<=54 or not 73<=lng<=136:
        return {'ok':False,'status':'outside_coverage','msg':'该坐标超出本版中国土壤数据查询范围。'}
    required=['AN','AP','AK','PH','BD']
    missing=[k for k in required if not (directory/(k+'-surface.nc')).exists()]
    if missing:return {'ok':False,'status':'data_pending','msg':'国内土壤数据尚未准备完整，请等待数据处理完成。','missing':missing}
    fields={};cell=None
    for key,(name,label,unit) in FIELDS.items():
        file=directory/(key+'-surface.nc')
        if not file.exists():continue
        with Dataset(file) as ds:
            la=np.asarray(ds['lat'][:]);lo=np.asarray(ds['lon'][:]);i=int(np.argmin(abs(la-lat)));j=int(np.argmin(abs(lo-lng)))
            if abs(float(la[i])-lat)>.0043 or abs(float(lo[j])-lng)>.0043:return {'ok':False,'status':'outside_coverage','msg':'该坐标没有对应的国内土壤栅格。'}
            value=ds[key][i,j]
            if np.ma.is_masked(value) or not np.isfinite(value) or float(value)==-999:
                if key in required:return {'ok':False,'status':'no_data','msg':'该栅格缺少有效土壤数据，可能为水体、非土壤区或数据空白。请调整点位或填写实测值。'}
                continue
            raw=float(value);source_unit=ds[key].units.strip()
            # Verified against the original files. Fail closed on unexpected units.
            if key in ['AN','AP','AK']:
                if source_unit!='ppm of weight':raise ValueError('Unexpected nutrient unit')
            elif key=='SOM':
                if source_unit in ['percentage of weight','% of weight']:raw*=10
                elif source_unit not in ['g/kg','g kg-1']:raise ValueError('Unexpected SOM unit: '+source_unit)
            elif key=='BD':
                if source_unit not in ['g/cm3','g/cm^3','g cm-3']:raise ValueError('Unexpected bulk density unit: '+source_unit)
            fields[name]={'label':label,'value':round(raw,4),'unit':unit,'sourceUnit':source_unit}
            cell={'lat':round(float(la[i]),6),'lng':round(float(lo[j]),6)}
    return {'ok':True,'status':'ready','fields':fields,'cell':cell,'depthCm':[0,4.5],
        'source':{'title':'面向陆面模拟的中国土壤数据集','authors':'戴永久、上官微','doi':'10.11888/Soil.tpdc.270281',
        'url':'https://data.tpdc.ac.cn/en/data/8ba0a731-5b0b-4e2f-8b95-8b29cc3c0f3a/',
        'period':'1980年代土壤普查背景','resolution':'30弧秒（约1 km）','license':'CC BY-NC-SA 4.0'},
        'limitations':['只读取0–4.5 cm表层，不能代表完整根区；格网背景值不是实时测土。','未提取独立QC层，已应用原始缺失值掩膜。','养分浓度不能直接等同一季作物可吸收量，试算转换系数需要本地标定。']}

if __name__=='__main__':
    try:print(json.dumps(query(Path(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3])),ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok':False,'status':'read_error','msg':'土壤文件读取失败，请检查数据及读取依赖。','detail':str(e)},ensure_ascii=False))
        sys.exit(1)
