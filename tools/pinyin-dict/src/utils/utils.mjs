import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as events from 'events';
import * as readline from 'readline';

import * as fontkit from 'fontkit';
import getSystemFonts from 'get-system-fonts';
import GraphemeSplitter from 'grapheme-splitter';

import { pinyin as parsePinyin, addDict } from 'pinyin-pro';
// https://pinyin-pro.cn/use/addDict.html
import CompleteDict from '@pinyin-pro/data/complete';

addDict(CompleteDict);

const systemFonts = await prepareSystemFonts();
const graphemeSplitter = new GraphemeSplitter();

// https://codingbeautydev.com/blog/javascript-dirname-is-not-defined-in-es-module-scope/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function asyncForEach(array, cb) {
  for (const e of array) {
    await cb(e);
  }
}

export function fromRootPath(...paths) {
  return path.join(__dirname, '../..', ...paths);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function fileSHA256(filepath) {
  // https://gist.github.com/GuillermoPena/9233069#gistcomment-3149231-permalink
  const file = fs.readFileSync(filepath);
  const hash = crypto.createHash('sha256');
  hash.update(file);

  return hash.digest('hex');
}

export function existFile(filepath) {
  return fs.existsSync(filepath);
}

export function copyFile(source, target, override) {
  if (existFile(target) && override !== true) {
    return;
  }

  fs.copyFileSync(source, target);
}

export function readJSONFromFile(filepath, defaultValue = {}) {
  if (!existFile(filepath)) {
    return defaultValue;
  }

  return JSON.parse(readFile(filepath));
}

export function readFile(filepath) {
  return fs.readFileSync(filepath, 'utf8');
}

export function readAllFiles(dir) {
  return getAllFiles(dir).map((file) => readFile(file));
}

export function getAllFiles(dir) {
  if (Array.isArray(dir)) {
    return dir.map(getAllFiles).reduce((acc, files) => acc.concat(files), []);
  }

  if (fs.lstatSync(dir).isFile()) {
    return [dir];
  }

  let files = [];
  fs.readdirSync(dir).forEach((file) => {
    const filepath = path.join(dir, file);

    if (fs.lstatSync(filepath).isDirectory()) {
      files = files.concat(getAllFiles(filepath));
    } else {
      files.push(filepath);
    }
  });

  return files;
}

export async function readLineFromFile(filepath, consumer) {
  if (!existFile(filepath)) {
    return [];
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filepath),
    crlfDelay: Infinity
  });

  const results = [];
  rl.on('line', (line) => {
    const result = consumer(line);
    if (typeof result !== 'undefined') {
      results.push(result);
    }
  });

  await events.once(rl, 'close');

  return results;
}

export function appendLineToFile(filepath, line, doEmpty) {
  const dirpath = path.dirname(filepath);

  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath);
  }

  if (!fs.existsSync(filepath) || doEmpty) {
    fs.writeFileSync(filepath, '');
  }

  let fd;
  try {
    fd = fs.openSync(filepath, 'a');
    fs.appendFileSync(fd, line + '\n', 'utf8');
  } finally {
    fd && fs.closeSync(fd);
  }
}

export function naiveHTMLNodeInnerText(node) {
  // https://github.com/jsdom/jsdom/issues/1245#issuecomment-1243809196
  // We need Node(DOM's Node) for the constants,
  // but Node doesn't exist in the nodejs global space,
  // and any Node instance references the constants
  // through the prototype chain
  const Node = node;

  return node && node.childNodes
    ? [...node.childNodes]
        .map((node) => {
          switch (node.nodeType) {
            case Node.TEXT_NODE:
              return node.textContent;
            case Node.ELEMENT_NODE:
              return naiveHTMLNodeInnerText(node);
            default:
              return '';
          }
        })
        .join(' ')
    : '';
}

async function prepareSystemFonts() {
  // https://www.npmjs.com/package/get-system-fonts
  const fontFiles = await getSystemFonts();
  const fonts = [];

  // https://github.com/foliojs/fontkit#fonthasglyphforcodepointcodepoint
  fontFiles.forEach((file) => {
    try {
      const font = fontkit.openSync(file);
      if (!font.hasGlyphForCodePoint) {
        return;
      }

      //console.info('Read font file: ' + file);
      fonts.push(font);
    } catch (e) {
      //console.warn('Failed to read font file: ' + file, e);
    }
  });

  return fonts;
}

/** 判断系统字体中是否存在指定编码的字形，若不存在，则表示该编码的字不可读 */
export function hasGlyphFontForCodePoint(unicode) {
  const codePoint = parseInt('0x' + unicode.replaceAll(/^U\+/g, ''), 16);

  for (let i = 0; i < systemFonts.length; i++) {
    const font = systemFonts[i];

    if (font.hasGlyphForCodePoint(codePoint)) {
      return true;
    }
  }
  return false;
}

/** 部分中文和表情符号等占用字节数大于 2，比如: 𫫇，需单独处理 */
export function splitChars(str) {
  // https://github.com/orling/grapheme-splitter
  return graphemeSplitter.splitGraphemes(str);
}

/** @return ['nǐ', 'hǎo', 'ma'] */
export function getPinyin(str) {
  // https://pinyin-pro.cn/use/pinyin.html
  return parsePinyin(str, {
    // 输出为数组
    type: 'array',
    // 作为音调符号带在拼音字母上
    toneType: 'symbol',
    // 识别字符串开头的姓氏
    surname: 'head',
    // 是否对一和不应用智能变调
    // 不（bù）在去声字前面读阳平声，如“～会”“～是”，这属于变调读音
    // http://www.moe.gov.cn/jyb_hygq/hygq_zczx/moe_1346/moe_1364/tnull_42118.html
    // “一”和“不”变调有规律：https://www.chinanews.com.cn/hwjy/news/2010/04-15/2228742.shtml
    toneSandhi: true
  });
}

/** 修正拼音 */
export function correctPinyin(str) {
  return str
    .replaceAll('ā', 'ā')
    .replaceAll('ă', 'ǎ')
    .replaceAll('à', 'à')
    .replaceAll('ɑ', 'a')
    .replaceAll('ō', 'ō')
    .replaceAll('ŏ', 'ǒ')
    .replaceAll('ī', 'ī')
    .replaceAll('ĭ', 'ǐ')
    .replaceAll('ŭ', 'ǔ')
    .replaceAll('ɡ', 'g')
    .replaceAll('ē', 'ē')
    .replaceAll(/[·]/g, '');
}

/** 修正注音 */
export function correctZhuyin(str) {
  return str.replaceAll('π', 'ㄫ').replaceAll('˙', '');
}

/** 拼音去掉声调后的字母组合 */
export function extractPinyinChars(pinyin) {
  if ('m̀' === pinyin || 'ḿ' === pinyin || 'm̄' === pinyin) {
    return 'm';
  } else if (
    'ê̄' === pinyin ||
    'ế' === pinyin ||
    'ê̌' === pinyin ||
    'ề' === pinyin
  ) {
    return 'e';
  }

  const chars = [];

  const splits = splitChars(pinyin);
  for (let i = 0; i < splits.length; i++) {
    const ch = splits[i];
    switch (ch) {
      case 'ā':
      case 'á':
      case 'ǎ':
      case 'à':
        chars.push('a');
        break;
      case 'ō':
      case 'ó':
      case 'ǒ':
      case 'ò':
        chars.push('o');
        break;
      case 'ē':
      case 'é':
      case 'ě':
      case 'è':
      case 'ê':
        chars.push('e');
        break;
      case 'ī':
      case 'í':
      case 'ǐ':
      case 'ì':
        chars.push('i');
        break;
      case 'ū':
      case 'ú':
      case 'ǔ':
      case 'ù':
        chars.push('u');
        break;
      case 'ǖ':
      case 'ǘ':
      case 'ǚ':
      case 'ǜ':
        chars.push('ü');
        break;
      case 'ń':
      case 'ň':
      case 'ǹ':
        chars.push('n');
        break;
      default:
        chars.push(ch);
    }
  }

  return chars.join('');
}

export function getPinyinTone(pinyin) {
  const tones = {
    ā: 1,
    á: 2,
    ǎ: 3,
    à: 4,
    //
    ō: 1,
    ó: 2,
    ǒ: 3,
    ò: 4,
    //
    ē: 1,
    é: 2,
    ě: 3,
    è: 4,
    ê: 0,
    ê̄: 1,
    ế: 2,
    ê̌: 3,
    ề: 4,
    //
    ī: 1,
    í: 2,
    ǐ: 3,
    ì: 4,
    //
    ū: 1,
    ú: 2,
    ǔ: 3,
    ù: 4,
    //
    ǖ: 1,
    ǘ: 2,
    ǚ: 3,
    ǜ: 4,
    //
    ń: 2,
    ň: 3,
    ǹ: 4,
    //
    m̄: 1,
    ḿ: 2,
    m̀: 4
  };

  for (let ch in tones) {
    if (pinyin.includes(ch)) {
      return tones[ch];
    }
  }

  return 0;
}

/** 注音去掉声调后的字符组合 */
export function extractZhuyinChars(zhuyin) {
  return zhuyin.replaceAll(/[ˊˇˋˉ˙]/g, '');
}

/**
 * 计算两个笔画的相似度（Levenshtein Distance）：
 * - [Sort an array by the "Levenshtein Distance" with best performance in Javascript](https://stackoverflow.com/a/11958496)
 * - [字符串编辑距离之 Damerau–Levenshtein Distance](https://blog.csdn.net/asty9000/article/details/81570627)
 * - [字符串编辑距离之 Levenshtein Distance](https://blog.csdn.net/asty9000/article/details/81384650)
 * - [Damerau–Levenshtein distance](https://en.wikipedia.org/wiki/Damerau%E2%80%93Levenshtein_distance)
 */
export function calculateStrokeSimilarity(s, t) {
  const d = []; // 2d matrix

  // Step 1
  const n = s.length;
  const m = t.length;

  if (n == 0) return 0;
  if (m == 0) return 0;

  // Create an array of arrays in javascript (a descending loop is quicker)
  for (let i = n; i >= 0; i--) d[i] = [];

  // Step 2
  for (let i = n; i >= 0; i--) d[i][0] = i;
  for (let j = m; j >= 0; j--) d[0][j] = j;

  // Step 3
  for (let i = 1; i <= n; i++) {
    const s_i = s.charAt(i - 1);

    // Step 4
    for (let j = 1; j <= m; j++) {
      // Check the jagged ld total so far
      if (i == j && d[i][j] > 4) return n;

      const t_j = t.charAt(j - 1);
      const cost = s_i == t_j ? 0 : 1; // Step 5

      // Calculate the minimum
      let mi = d[i - 1][j] + 1;
      const b = d[i][j - 1] + 1;
      const c = d[i - 1][j - 1] + cost;

      if (b < mi) mi = b;
      if (c < mi) mi = c;

      d[i][j] = mi; // Step 6

      // Note: 不做转换变换
      // // Damerau transposition
      // if (i > 1 && j > 1 && s_i == t.charAt(j - 2) && s.charAt(i - 2) == t_j) {
      //   d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      // }
    }
  }

  // Step 7
  return 1 - d[n][m] / Math.max(n, m);
}
