#!/usr/bin/env python3
"""Read actual grid cell values. If the clicked cell has no soil (city, water, data gap), fall back to the
nearest cell with complete data within MAX_NEAREST_KM and say so; never use national defaults."""
import json, math, sys
from contextlib import ExitStack
from pathlib import Path
import numpy as np
from netCDF4 import Dataset

FIELDS={'AN':('availableN','碱解氮','mg/kg'), 'AP':('availableP','有效磷','mg/kg'), 'AK':('availableK','速效钾','mg/kg'), 'PH':('ph','pH','pH'), 'BD':('bulkDensity','容重','g/cm³'), 'SOM':('organicMatter','有机质','g/kg')}

MAX_NEAREST_KM=2.0
SEARCH_CELLS=3  # 30" cells are ~0.93 km apart, so 3 cells covers the 2 km radius

def distance_km(lat1,lng1,lat2,lng2):
    p1,p2=math.radians(lat1),math.radians(lat2);dp=p2-p1;dl=math.radians(lng2-lng1)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 6371*2*math.asin(math.sqrt(h))

def cell_index(ds,lat,lng):
    la=np.asarray(ds['lat'][:]);lo=np.asarray(ds['lon'][:]);i=int(np.argmin(abs(la-lat)));j=int(np.argmin(abs(lo-lng)))
    if abs(float(la[i])-lat)>.0043 or abs(float(lo[j])-lng)>.0043:return None
    return i,j,float(la[i]),float(lo[j])

def cell_value(ds,key,i,j):
    value=ds[key][i,j]
    if np.ma.is_masked(value) or not np.isfinite(value) or float(value)==-999:return None
    return value

def query(directory,lat,lng):
    if not np.isfinite(lat) or not np.isfinite(lng) or not 17.8<=lat<=54 or not 73<=lng<=136:
        return {'ok':False,'status':'outside_coverage','msg':'该坐标超出本版中国土壤数据查询范围。'}
    required=['AN','AP','AK','PH','BD']
    missing=[k for k in required if not (directory/(k+'-surface.nc')).exists()]
    if missing:return {'ok':False,'status':'data_pending','msg':'国内土壤数据尚未准备完整，请等待数据处理完成。','missing':missing}
    with ExitStack() as stack:
        sets={key:stack.enter_context(Dataset(directory/(key+'-surface.nc'))) for key in FIELDS if (directory/(key+'-surface.nc')).exists()}
        base=cell_index(sets['AN'],lat,lng)
        if base is None:return {'ok':False,'status':'outside_coverage','msg':'该坐标没有对应的国内土壤栅格。'}
        la=np.asarray(sets['AN']['lat'][:]);lo=np.asarray(sets['AN']['lon'][:])
        candidates=[]
        for di in range(-SEARCH_CELLS,SEARCH_CELLS+1):
            for dj in range(-SEARCH_CELLS,SEARCH_CELLS+1):
                ci,cj=base[0]+di,base[1]+dj
                if not (0<=ci<len(la) and 0<=cj<len(lo)):continue
                d=0.0 if (di,dj)==(0,0) else distance_km(lat,lng,float(la[ci]),float(lo[cj]))
                if d<=MAX_NEAREST_KM:candidates.append((d,float(la[ci]),float(lo[cj])))
        candidates.sort()
        chosen=None
        for d,clat,clng in candidates:
            ok=True
            for key in required:
                idx=cell_index(sets[key],clat,clng)
                if idx is None or cell_value(sets[key],key,idx[0],idx[1]) is None:ok=False;break
            if ok:chosen=(d,clat,clng);break
        if chosen is None:
            return {'ok':False,'status':'no_data','msg':f'该点及周边{MAX_NEAREST_KM:g}公里内都没有有效土壤数据（可能是城区、水体或数据空白）。请把点移到附近农田，或填写实测值。'}
        fields={};cell=None;d,clat,clng=chosen
        for key,(name,label,unit) in FIELDS.items():
            if key not in sets:continue
            ds=sets[key];idx=cell_index(ds,clat,clng)
            if idx is None:continue
            value=cell_value(ds,key,idx[0],idx[1])
            if value is None:continue
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
            cell={'lat':round(idx[2],6),'lng':round(idx[3],6)}
    # The clicked cell itself counts as exact even if its centre is a few hundred metres away.
    nearest={'distanceKm':round(d,1),'maxKm':MAX_NEAREST_KM} if d>0 else None
    return {'ok':True,'status':'ready','fields':fields,'cell':cell,'nearest':nearest,'depthCm':[0,4.5],
        'source':{'title':'面向陆面模拟的中国土壤数据集','authors':'戴永久、上官微','doi':'10.11888/Soil.tpdc.270281',
        'url':'https://data.tpdc.ac.cn/en/data/8ba0a731-5b0b-4e2f-8b95-8b29cc3c0f3a/',
        'period':'1980年代土壤普查背景','resolution':'30弧秒（约1 km）','license':'CC BY-NC-SA 4.0'},
        'limitations':['只读取0–4.5 cm表层，不能代表完整根区；格网背景值不是实时测土。','未提取独立QC层，已应用原始缺失值掩膜。','养分浓度不能直接等同一季作物可吸收量，试算转换系数需要本地标定。']}

if __name__=='__main__':
    try:print(json.dumps(query(Path(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3])),ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok':False,'status':'read_error','msg':'土壤文件读取失败，请检查数据及读取依赖。','detail':str(e)},ensure_ascii=False))
        sys.exit(1)
