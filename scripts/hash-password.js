'use strict';
// Делает хэш пароля для файла .env.
// Запуск: npm run hash -- "твой-пароль"
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Укажи пароль: npm run hash -- "твой-пароль"');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Пароль слишком короткий. Возьми хотя бы 10 символов, лучше 14+.');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
console.log(`scrypt.${salt}.${hash}`);
