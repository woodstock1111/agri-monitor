const http = require('http');

async function diag() {
  const login = 'h260415rdny';
  const pass = 'h260415rdny';
  const baseUrl = 'http://www.0531yun.com';

  const tokenRes = await new Promise(r => {
    http.get(`${baseUrl}/api/getToken?loginName=${login}&password=${pass}`, res => {
      let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => r(JSON.parse(d)));
    });
  });
  const token = tokenRes.data.token;

  // Use the exact time range the user had trouble with
  const start = '2026-04-16 17:32:00';
  const end = '2026-04-17 17:32:00';
  const url = `${baseUrl}/api/data/historyList?deviceAddr=21133475&nodeId=1&startTime=${start.replace(' ', '%20')}&endTime=${end.replace(' ', '%20')}&pageSize=2`;
  
  console.log('Requesting:', url);

  const rawData = await new Promise(r => {
    http.get(url, { headers: { 'authorization': token } }, res => {
      let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => r(d));
    });
  });

  try {
    const json = JSON.parse(rawData);
    console.log('Full API Response Structure:');
    console.log(JSON.stringify(json, null, 2).substring(0, 2000));
  } catch (e) {
    console.log('Parse Fail. Body starts with:', rawData.substring(0, 500));
  }
}

diag().catch(console.error);
