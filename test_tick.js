const http = require('http');

http.get('http://127.0.0.1:3000/api/rates?symbol=EURUSD&tf=M5&count=2', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Rates:', data));
});
