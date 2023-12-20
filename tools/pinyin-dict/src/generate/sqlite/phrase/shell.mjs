/* SQLite 词典库 */
import { fromRootPath } from '../../../utils/utils.mjs';
import * as sqlite from './sqlite.mjs';
import inquirer from 'inquirer';

// SQLite 词典库
const phraseDictSQLiteFile = fromRootPath('data', 'pinyin-phrase-dict.sqlite');

console.log();
let phraseDictDB = await sqlite.open(phraseDictSQLiteFile, true);

phraseDictDB = await sqlite.attach(phraseDictDB, {
  // SQLite 字典库
  word: fromRootPath('data', 'pinyin-word-dict.sqlite')
});

try {
  while (await start(phraseDictDB)) {}
} catch (e) {
  throw e;
} finally {
  await sqlite.close(phraseDictDB);
}

console.log();

async function start(phraseDictDB) {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'pinyin',
      message: '请输入拼音，拼音之间以空格分隔:'
    }
  ]);

  const pinyin = answer.pinyin.trim();
  if (!pinyin) {
    return false;
  }

  const chars = pinyin.split(/\s+/g);
  const words = await sqlite.predict(phraseDictDB, chars);

  words.forEach((w, i) => {
    console.log(i + 1, w[0], w[1].join(''));
  });

  return true;
}
