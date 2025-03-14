import { splitChars, appendLineToFile, asyncForEach } from '#utils/utils.mjs';
import { saveToDB, removeFromDB, execSQL } from '#utils/sqlite.mjs';

export { openDB as open, closeDB as close } from '#utils/sqlite.mjs';

/** 保存拼音和注音信息 */
export async function saveSpells(db, wordMetas) {
  await execSQL(
    db,
    `
  -- 不含声调的拼音字母组合
  create table
    if not exists meta_pinyin_chars (
      id_ integer not null primary key,
      value_ text not null,
      unique (value_)
    );
  -- 含声调的拼音：可根据 id_ 大小排序
  create table
    if not exists meta_pinyin (
      id_ integer not null primary key,
      value_ text not null,
      -- 拼音字母组合 id
      chars_id_ integer not null,
      unique (value_),
      foreign key (chars_id_) references meta_pinyin_chars (id_)
    );

  -- --------------------------------------------------------------
  -- 不含声调的注音字符组合
  create table
    if not exists meta_zhuyin_chars (
      id_ integer not null primary key,
      value_ text not null,
      unique (value_)
    );
  -- 含声调的注音：可根据 id_ 大小排序
  create table
    if not exists meta_zhuyin (
      id_ integer not null primary key,
      value_ text not null,
      -- 注音字符组合 id
      chars_id_ integer not null,
      unique (value_),
      foreign key (chars_id_) references meta_zhuyin_chars (id_)
    );
`
  );

  await asyncForEach(
    [
      {
        prop: 'pinyins',
        table: 'meta_pinyin',
        chars_table: 'meta_pinyin_chars'
      },
      {
        prop: 'zhuyins',
        table: 'meta_zhuyin',
        chars_table: 'meta_zhuyin_chars'
      }
    ],
    async ({ prop, table, chars_table }) => {
      // ================================================================
      const spellMetaData = {};
      const charsMetaData = {};
      wordMetas.forEach((wordMeta) => {
        wordMeta[prop].forEach(({ value, chars }) => {
          if (value && !spellMetaData[value]) {
            spellMetaData[value] = {
              __chars__: chars,
              value_: value
            };
          }

          if (chars && !charsMetaData[chars]) {
            charsMetaData[chars] = {
              value_: chars
            };
          }
        });
      });

      // ================================================================
      const missingCharsMetas = [];
      (await db.all(`select * from ${chars_table}`)).forEach((row) => {
        const value = row.value_;
        const id = row.id_;

        if (charsMetaData[value]) {
          charsMetaData[value].id_ = id;
          charsMetaData[value].__exist__ = row;
        } else {
          // 在库中已存在，但未使用
          missingCharsMetas.push(id);
        }
      });
      await saveToDB(db, chars_table, charsMetaData);
      await removeFromDB(db, chars_table, missingCharsMetas);

      // 获取新增字符组合 id
      (await db.all(`select id_, value_ from ${chars_table}`)).forEach(
        (row) => {
          const value = row.value_;
          charsMetaData[value].id_ = row.id_;
        }
      );

      // ================================================================
      // 绑定读音与其字符组合
      Object.keys(spellMetaData).forEach((k) => {
        const spell = spellMetaData[k];
        const chars_id_ = (charsMetaData[spell.__chars__] || {}).id_;

        if (!chars_id_) {
          console.log('读音的字母组合不存在：', spell.value_, spell.__chars__);
        }

        spell.chars_id_ = chars_id_;
      });

      const missingSpellMetas = [];
      (await db.all(`select * from ${table}`)).forEach((row) => {
        const value = row.value_;
        const id = row.id_;

        if (spellMetaData[value]) {
          spellMetaData[value].id_ = id;
          spellMetaData[value].__exist__ = row;
        } else {
          // 在库中已存在，但未使用
          missingSpellMetas.push(id);
        }
      });

      await saveToDB(db, table, spellMetaData);
      await removeFromDB(db, table, missingSpellMetas);
    }
  );
}

/** 保存字信息 */
export async function saveWords(db, wordMetas) {
  await execSQL(
    db,
    `
  create table
    if not exists meta_word_radical (
      id_ integer not null primary key,
      value_ text not null,
      -- 笔画数
      stroke_count_ integer default 0,
      unique (value_)
    );

  create table
    if not exists meta_word (
      id_ integer not null primary key,
      value_ text not null,
      unicode_ text not null,
      -- 部首 id
      radical_id_ integer default null,
      -- 字形结构
      glyph_struct_ text default '',
      -- 笔画顺序：1 - 横，2 - 竖，3 - 撇，4 - 捺，5 - 折
      stroke_order_ text default '',
      -- 总笔画数
      total_stroke_count_ integer default 0,
      -- 是否为繁体字
      traditional_ integer default 0,
      -- 按部首分组计算的字形权重
      glyph_weight_ integer default 0,
      -- 字使用权重
      used_weight_ integer default 0,
      unique (value_),
      foreign key (radical_id_) references meta_word_radical (id_)
    );

  -- --------------------------------------------------------------
  create table
    if not exists meta_word_with_pinyin (
      id_ integer not null primary key,
      -- 字 id
      word_id_ integer not null,
      -- 拼音 id
      spell_id_ integer not null,
      -- 按拼音分组计算的字形权重
      glyph_weight_ integer default 0,
      unique (word_id_, spell_id_),
      foreign key (word_id_) references meta_word (id_),
      foreign key (spell_id_) references meta_pinyin (id_)
    );
  create table
    if not exists meta_word_with_zhuyin (
      id_ integer not null primary key,
      -- 字 id
      word_id_ integer not null,
      -- 注音 id
      spell_id_ integer not null,
      -- 按拼音分组计算的字形权重
      glyph_weight_ integer default 0,
      unique (word_id_, spell_id_),
      foreign key (word_id_) references meta_word (id_),
      foreign key (spell_id_) references meta_zhuyin (id_)
    );

  -- --------------------------------------------------------------
  create table
    if not exists link_word_with_simple_word (
      -- 源字 id
      source_id_ integer not null,
      -- 简体字 id
      target_id_ integer not null,
      primary key (source_id_, target_id_)
    );
  create table
    if not exists link_word_with_traditional_word (
      -- 源字 id
      source_id_ integer not null,
      -- 繁体字 id
      target_id_ integer not null,
      primary key (source_id_, target_id_)
    );
  create table
    if not exists link_word_with_variant_word (
      -- 源字 id
      source_id_ integer not null,
      -- 变体字 id
      target_id_ integer not null,
      primary key (source_id_, target_id_)
    );

  -- --------------------------------------------------------------
  create table
    if not exists meta_word_wubi_code (
      id_ integer not null primary key,
      value_ text not null,
      word_id_ integer not null,
      unique (value_, word_id_),
      foreign key (word_id_) references meta_word (id_)
    );
  create table
    if not exists meta_word_cangjie_code (
      id_ integer not null primary key,
      value_ text not null,
      word_id_ integer not null,
      unique (value_, word_id_),
      foreign key (word_id_) references meta_word (id_)
    );
  create table
    if not exists meta_word_zhengma_code (
      id_ integer not null primary key,
      value_ text not null,
      word_id_ integer not null,
      unique (value_, word_id_),
      foreign key (word_id_) references meta_word (id_)
    );
  create table
    if not exists meta_word_sijiao_code (
      id_ integer not null primary key,
      value_ text not null,
      word_id_ integer not null,
      unique (value_, word_id_),
      foreign key (word_id_) references meta_word (id_)
    );

  -- --------------------------------------------------------------
  create view
    if not exists link_word_with_pinyin (
      id_,
      word_id_,
      spell_id_,
      spell_chars_id_,
      glyph_weight_
    ) as
  select
    meta_.id_,
    meta_.word_id_,
    meta_.spell_id_,
    spell_.chars_id_,
    meta_.glyph_weight_
  from
    meta_word_with_pinyin meta_
    left join meta_pinyin spell_ on spell_.id_ = meta_.spell_id_;

  create view
    if not exists link_word_with_zhuyin (
      id_,
      word_id_,
      spell_id_,
      spell_chars_id_,
      glyph_weight_
    ) as
  select
    meta_.id_,
    meta_.word_id_,
    meta_.spell_id_,
    spell_.chars_id_,
    meta_.glyph_weight_
  from
    meta_word_with_zhuyin meta_
    left join meta_zhuyin spell_ on spell_.id_ = meta_.spell_id_;

  -- --------------------------------------------------------------
  -- 字及其拼音
  create view
    if not exists pinyin_word (
      id_,
      word_,
      word_id_,
      unicode_,
      used_weight_,
      spell_,
      spell_id_,
      spell_chars_,
      spell_chars_id_,
      glyph_weight_,
      glyph_struct_,
      radical_,
      radical_stroke_count_,
      stroke_order_,
      total_stroke_count_,
      traditional_,
      simple_word_,
      traditional_word_,
      variant_word_
    ) as
  select
    word_lnk_.id_,
    word_.value_,
    word_.id_,
    word_.unicode_,
    word_.used_weight_,
    spell_.value_,
    spell_.id_,
    spell_ch_.value_,
    spell_ch_.id_,
    word_lnk_.glyph_weight_,
    word_.glyph_struct_,
    radical_.value_,
    radical_.stroke_count_,
    word_.stroke_order_,
    word_.total_stroke_count_,
    word_.traditional_,
    sw_.value_,
    tw_.value_,
    vw_.value_
  from
    meta_word word_
    --
    left join meta_word_with_pinyin word_lnk_ on word_lnk_.word_id_ = word_.id_
    --
    left join meta_word_radical radical_ on radical_.id_ = word_.radical_id_
    left join meta_pinyin spell_ on spell_.id_ = word_lnk_.spell_id_
    left join meta_pinyin_chars spell_ch_ on spell_ch_.id_ = spell_.chars_id_
    --
    left join link_word_with_simple_word sw_lnk_ on sw_lnk_.source_id_ = word_.id_
    left join meta_word sw_ on sw_.id_ = sw_lnk_.target_id_
    left join link_word_with_traditional_word tw_lnk_ on tw_lnk_.source_id_ = word_.id_
    left join meta_word tw_ on tw_.id_ = tw_lnk_.target_id_
    left join link_word_with_variant_word vw_lnk_ on vw_lnk_.source_id_ = word_.id_
    left join meta_word vw_ on vw_.id_ = vw_lnk_.target_id_;

  -- 字及其注音
  create view
    if not exists zhuyin_word (
      id_,
      word_,
      word_id_,
      unicode_,
      used_weight_,
      spell_,
      spell_id_,
      spell_chars_,
      spell_chars_id_,
      glyph_weight_,
      glyph_struct_,
      radical_,
      radical_stroke_count_,
      stroke_order_,
      total_stroke_count_,
      traditional_,
      simple_word_,
      traditional_word_,
      variant_word_
    ) as
  select
    word_lnk_.id_,
    word_.value_,
    word_.id_,
    word_.unicode_,
    word_.used_weight_,
    spell_.value_,
    spell_.id_,
    spell_ch_.value_,
    spell_ch_.id_,
    word_lnk_.glyph_weight_,
    word_.glyph_struct_,
    radical_.value_,
    radical_.stroke_count_,
    word_.stroke_order_,
    word_.total_stroke_count_,
    word_.traditional_,
    sw_.value_,
    tw_.value_,
    vw_.value_
  from
    meta_word word_
    --
    left join meta_word_with_zhuyin word_lnk_ on word_lnk_.word_id_ = word_.id_
    --
    left join meta_word_radical radical_ on radical_.id_ = word_.radical_id_
    left join meta_zhuyin spell_ on spell_.id_ = word_lnk_.spell_id_
    left join meta_zhuyin_chars spell_ch_ on spell_ch_.id_ = spell_.chars_id_
    --
    left join link_word_with_simple_word sw_lnk_ on sw_lnk_.source_id_ = word_.id_
    left join meta_word sw_ on sw_.id_ = sw_lnk_.target_id_
    left join link_word_with_traditional_word tw_lnk_ on tw_lnk_.source_id_ = word_.id_
    left join meta_word tw_ on tw_.id_ = tw_lnk_.target_id_
    left join link_word_with_variant_word vw_lnk_ on vw_lnk_.source_id_ = word_.id_
    left join meta_word vw_ on vw_.id_ = vw_lnk_.target_id_;

  -- --------------------------------------------------------------
  -- 繁体 -> 简体
  create view
    if not exists simple_word (
      -- 繁体字 id
      source_id_,
      -- 繁体字
      source_value_,
      -- 简体字 id
      target_id_,
      -- 简体字
      target_value_
    ) as
  select
    source_.id_,
    source_.value_,
    target_.id_,
    target_.value_
  from
    link_word_with_simple_word lnk_
    inner join meta_word source_ on source_.id_ = lnk_.source_id_
    inner join meta_word target_ on target_.id_ = lnk_.target_id_;

  -- 简体 -> 繁体
  create view
    if not exists traditional_word (
      -- 简体字 id
      source_id_,
      -- 简体字
      source_value_,
      -- 繁体字 id
      target_id_,
      -- 繁体字
      target_value_
    ) as
  select
    source_.id_,
    source_.value_,
    target_.id_,
    target_.value_
  from
    link_word_with_traditional_word lnk_
    inner join meta_word source_ on source_.id_ = lnk_.source_id_
    inner join meta_word target_ on target_.id_ = lnk_.target_id_;
`
  );

  // ================================================================
  const wordMetaData = {};
  const wordRadicalMetaData = {};
  wordMetas.forEach((meta) => {
    wordMetaData[meta.value] = {
      __meta__: meta,
      value_: meta.value,
      unicode_: meta.unicode,
      glyph_struct_: meta.glyph_struct,
      stroke_order_: meta.stroke_order,
      total_stroke_count_: meta.total_stroke_count,
      traditional_: meta.traditional,
      glyph_weight_: meta.glyph_weight || 0,
      used_weight_: meta.used_weight || 0,
    };

    const radical = meta.radical;
    if (radical) {
      wordRadicalMetaData[radical] = {
        value_: radical,
        stroke_count_: meta.radical_stroke_count || 0
      };
    }
  });

  // ================================================================
  // 保存字部首信息
  const missingWordRadicals = [];
  (await db.all('select * from meta_word_radical')).forEach((row) => {
    const id = row.id_;
    const value = row.value_;

    if (wordRadicalMetaData[value]) {
      wordRadicalMetaData[value].id_ = id;
      wordRadicalMetaData[value].__exist__ = row;
    } else {
      // 在库中已存在，但未使用
      missingWordRadicals.push(id);
    }
  });
  await saveToDB(db, 'meta_word_radical', wordRadicalMetaData);
  await removeFromDB(db, 'meta_word_radical', missingWordRadicals);

  // 获取新增字部首 id
  (await db.all('select id_, value_ from meta_word_radical')).forEach((row) => {
    const value = row.value_;
    wordRadicalMetaData[value].id_ = row.id_;
  });

  // ================================================================
  // 绑定字与其部首
  Object.keys(wordMetaData).forEach((k) => {
    const word = wordMetaData[k];
    const radical = word.__meta__.radical;
    const radical_id_ = (wordRadicalMetaData[radical] || {}).id_;

    if (!radical_id_) {
      console.log('字的部首不存在：', word.value_, radical);
    }

    word.radical_id_ = radical_id_;
  });

  // 保存字信息
  const missingWords = [];
  (await db.all('select * from meta_word')).forEach((row) => {
    const id = row.id_;
    const value = row.value_;

    if (wordMetaData[value]) {
      wordMetaData[value].id_ = id;
      wordMetaData[value].__exist__ = row;
    } else {
      // 在库中已存在，但未使用
      missingWords.push(id);
    }
  });
  await saveToDB(db, 'meta_word', wordMetaData);
  await removeFromDB(db, 'meta_word', missingWords);

  // 获取新增字 id
  (await db.all('select id_, value_ from meta_word')).forEach((row) => {
    const value = row.value_;
    wordMetaData[value].id_ = row.id_;
  });

  // ================================================================
  // 绑定读音关联
  await asyncForEach(
    [
      {
        prop: 'pinyins',
        table: 'meta_word_with_pinyin',
        target_meta_table: 'meta_pinyin'
      },
      {
        prop: 'zhuyins',
        table: 'meta_word_with_zhuyin',
        target_meta_table: 'meta_zhuyin'
      }
    ],
    async ({ prop, table, target_meta_table }) => {
      const targetMetaMap = {};
      (await db.all(`select id_, value_ from ${target_meta_table}`)).forEach(
        (row) => {
          targetMetaMap[row.value_] = row.id_;
        }
      );

      const linkDataMap = {};
      Object.values(wordMetaData).forEach((source) => {
        source.__meta__[prop].forEach((target) => {
          const word_id_ = source.id_;
          const spell_id_ = targetMetaMap[target.value];
          const glyph_weight_ = target.glyph_weight || 0;

          const code = word_id_ + ':' + spell_id_;
          linkDataMap[code] = {
            word_id_,
            spell_id_,
            glyph_weight_
          };
        });
      });

      const missingLinks = [];
      (await db.all(`select * from ${table}`)).forEach((row) => {
        const id = row.id_;
        const code = row.word_id_ + ':' + row.spell_id_;

        if (linkDataMap[code]) {
          linkDataMap[code].id_ = id;
          linkDataMap[code].__exist__ = row;
        } else {
          // 在库中已存在，但未使用
          missingLinks.push(id);
        }
      });

      await saveToDB(db, table, linkDataMap);
      await removeFromDB(db, table, missingLinks);
    }
  );

  // ================================================================
  // 绑定字与字的关联
  await asyncForEach(
    [
      {
        prop: 'simple_words',
        table: 'link_word_with_simple_word'
      },
      {
        prop: 'variant_words',
        table: 'link_word_with_variant_word'
      },
      {
        prop: 'traditional_words',
        table: 'link_word_with_traditional_word'
      }
    ],
    async ({ prop, table }) => {
      const primaryKeys = ['source_id_', 'target_id_'];

      const linkData = {};
      (await db.all(`select * from ${table}`)).forEach((row) => {
        const code = row.source_id_ + ':' + row.target_id_;
        linkData[code] = {
          ...row,
          __exist__: row
        };
      });

      Object.values(wordMetaData).forEach((source) => {
        source.__meta__[prop].forEach((target) => {
          const source_id_ = source.id_;
          const target_id_ = (wordMetaData[target] || {}).id_;
          if (!target_id_) {
            return;
          }

          const code = source_id_ + ':' + target_id_;
          if (!linkData[code]) {
            // 新增关联
            linkData[code] = {
              source_id_,
              target_id_
            };
          } else {
            // 关联无需更新
            delete linkData[code];
          }
        });
      });

      const missingLinks = [];
      Object.keys(linkData).forEach((code) => {
        const data = linkData[code];

        if (data.__exist__) {
          // 关联在库中已存在，但未使用
          missingLinks.push(data);

          delete linkData[code];
        }
      });

      await saveToDB(db, table, linkData, true, primaryKeys);
      await removeFromDB(db, table, missingLinks, primaryKeys);
    }
  );

  // ================================================================
  // 绑定字与编码的关联
  await asyncForEach(
    [
      {
        prop: 'wubi_codes',
        table: 'meta_word_wubi_code'
      },
      {
        prop: 'cangjie_codes',
        table: 'meta_word_cangjie_code'
      },
      {
        prop: 'zhengma_codes',
        table: 'meta_word_zhengma_code'
      },
      {
        prop: 'sijiao_codes',
        table: 'meta_word_sijiao_code'
      }
    ],
    async ({ prop, table }) => {
      const linkData = {};
      (await db.all(`select * from ${table}`)).forEach((row) => {
        const code = row.value_ + ':' + row.word_id_;
        linkData[code] = {
          ...row,
          __exist__: row
        };
      });

      Object.values(wordMetaData).forEach((source) => {
        source.__meta__[prop].forEach((target) => {
          const value_ = target;
          const word_id_ = source.id_;
          const code = value_ + ':' + word_id_;

          if (!linkData[code]) {
            // 新增关联
            linkData[code] = {
              value_,
              word_id_
            };
          } else {
            // 关联无需更新
            delete linkData[code];
          }
        });
      });

      const missingLinks = [];
      Object.keys(linkData).forEach((code) => {
        const id = linkData[code].id_;

        if (id) {
          // 关联在库中已存在，但未使用
          missingLinks.push(id);

          delete linkData[code];
        }
      });

      await saveToDB(db, table, linkData);
      await removeFromDB(db, table, missingLinks);
    }
  );
}

/** 保存词组信息 */
export async function savePhrases(db, wordMetas) {
  await execSQL(
    db,
    `
  create table
    if not exists meta_phrase (
      id_ integer not null primary key,
      -- 短语文本内容
      value_ text not null,
      -- 短语序号：针对排序后的多音词的词序号
      index_ integer not null,
      -- 按使用频率等排序的权重
      weight_ integer default 0,
      unique (value_, index_)
    );

  -- --------------------------------------------------------------
  create table
    if not exists meta_phrase_with_pinyin_word (
      id_ integer not null primary key,
      -- 短语 id
      phrase_id_ integer not null,
      -- 字及其拼音关联表 meta_word_with_pinyin 的 id
      word_id_ integer not null,
      -- 字在短语中的序号
      word_index_ integer not null,
      unique (
        phrase_id_,
        word_id_,
        word_index_
      ),
      foreign key (phrase_id_) references meta_phrase (id_),
      foreign key (word_id_) references meta_word_with_pinyin (id_)
    );
  create table
    if not exists meta_phrase_with_zhuyin_word (
      id_ integer not null primary key,
      -- 短语 id
      phrase_id_ integer not null,
      -- 字及其注音关联表 meta_word_with_zhuyin 的 id
      word_id_ integer not null,
      -- 字在短语中的序号
      word_index_ integer not null,
      unique (
        phrase_id_,
        word_id_,
        word_index_
      ),
      foreign key (phrase_id_) references meta_phrase (id_),
      foreign key (word_id_) references meta_word_with_zhuyin (id_)
    );

  -- --------------------------------------------------------------
  create view
    if not exists link_phrase_with_pinyin_word (
      id_,
      source_id_,
      target_id_,
      target_spell_chars_id_,
      target_index_
    ) as
  select
    meta_.id_,
    meta_.phrase_id_,
    meta_.word_id_,
    spell_.chars_id_,
    meta_.word_index_
  from
    meta_phrase_with_pinyin_word meta_
    --
    left join meta_word_with_pinyin word_ on word_.id_ = meta_.word_id_
    left join meta_pinyin spell_ on spell_.id_ = word_.spell_id_;

  create view
    if not exists link_phrase_with_zhuyin_word (
      id_,
      source_id_,
      target_id_,
      target_spell_chars_id_,
      target_index_
    ) as
  select
    meta_.id_,
    meta_.phrase_id_,
    meta_.word_id_,
    spell_.chars_id_,
    meta_.word_index_
  from
    meta_phrase_with_zhuyin_word meta_
    --
    left join meta_word_with_zhuyin word_ on word_.id_ = meta_.word_id_
    left join meta_zhuyin spell_ on spell_.id_ = word_.spell_id_;

  -- --------------------------------------------------------------
  -- 短语及其拼音
  create view
    if not exists pinyin_phrase (
      id_,
      value_,
      index_,
      weight_,
      word_,
      word_index_,
      word_spell_,
      word_spell_chars_,
      word_spell_chars_id_
    ) as
  select
    phrase_.id_,
    phrase_.value_,
    phrase_.index_,
    phrase_.weight_,
    word_.value_,
    lnk_.word_index_,
    spell_.value_,
    spell_ch_.value_,
    spell_.chars_id_
  from
    meta_phrase phrase_
    --
    left join meta_phrase_with_pinyin_word lnk_ on lnk_.phrase_id_ = phrase_.id_
    --
    left join meta_word_with_pinyin word_lnk_ on word_lnk_.id_ = lnk_.word_id_
    left join meta_word word_ on word_.id_ = word_lnk_.word_id_
    left join meta_pinyin spell_ on spell_.id_ = word_lnk_.spell_id_
    left join meta_pinyin_chars spell_ch_ on spell_ch_.id_ = spell_.chars_id_
  -- Note: group by 不能对组内元素排序，故，只能在视图内先排序
  order by
    phrase_.index_ asc,
    lnk_.word_index_ asc;

  -- 短语及其注音
  create view
    if not exists zhuyin_phrase (
      id_,
      value_,
      index_,
      weight_,
      word_,
      word_index_,
      word_spell_,
      word_spell_chars_,
      word_spell_chars_id_
    ) as
  select
    phrase_.id_,
    phrase_.value_,
    phrase_.index_,
    phrase_.weight_,
    word_.value_,
    lnk_.word_index_,
    spell_.value_,
    spell_ch_.value_,
    spell_ch_.id_
  from
    meta_phrase phrase_
    --
    left join meta_phrase_with_zhuyin_word lnk_ on lnk_.phrase_id_ = phrase_.id_
    --
    left join meta_word_with_zhuyin word_lnk_ on word_lnk_.id_ = lnk_.word_id_
    left join meta_word word_ on word_.id_ = word_lnk_.word_id_
    left join meta_zhuyin spell_ on spell_.id_ = word_lnk_.spell_id_
    left join meta_zhuyin_chars spell_ch_ on spell_ch_.id_ = spell_.chars_id_
  -- Note: group by 不能对组内元素排序，故，只能在视图内先排序
  order by
    phrase_.index_ asc,
    lnk_.word_index_ asc;
`
  );

  // ================================================================
  const phraseMetaMap = wordMetas.reduce((map, meta) => {
    meta.phrases.forEach((phrase) => {
      const value = phrase.value.join('');
      const weight = phrase.weight || 0;

      phrase.pinyins.forEach((pinyin, index) => {
        if (phrase.value.length !== pinyin.value.length) {
          return;
        }

        const code = `${value}:${index}`;
        const zhuyin = phrase.zhuyins[index] || { value: [] };
        map[code] = {
          __meta__: {
            value: phrase.value,
            pinyins: pinyin.value,
            zhuyins:
              zhuyin.value.length !== phrase.value.length ? [] : zhuyin.value
          },
          value_: value,
          index_: index,
          weight_: weight
        };
      });
    });

    return map;
  }, {});

  // ================================================================
  // 保存短语信息
  const missingPhrases = [];
  (await db.all('select * from meta_phrase')).forEach((row) => {
    const value = row.value_;
    const id = row.id_;
    const code = `${value}:${row.index_}`;

    if (phraseMetaMap[code]) {
      phraseMetaMap[code].id_ = id;
      phraseMetaMap[code].__exist__ = row;
    } else {
      missingPhrases.push(id);
    }
  });
  await saveToDB(db, 'meta_phrase', phraseMetaMap);
  await removeFromDB(db, 'meta_phrase', missingPhrases);

  // 获取新增短语 id
  (await db.all('select id_, value_, index_ from meta_phrase')).forEach(
    (row) => {
      const value = row.value_;
      const code = `${value}:${row.index_}`;

      phraseMetaMap[code].id_ = row.id_;
    }
  );

  // ================================================================
  // 绑定读音关联
  await asyncForEach(
    [
      {
        prop: 'pinyins',
        table: 'meta_phrase_with_pinyin_word',
        word_table: 'meta_word',
        word_spell_link_table: 'meta_word_with_pinyin',
        word_spell_table: 'meta_pinyin'
      },
      {
        prop: 'zhuyins',
        table: 'meta_phrase_with_zhuyin_word',
        word_table: 'meta_word',
        word_spell_link_table: 'meta_word_with_zhuyin',
        word_spell_table: 'meta_zhuyin'
      }
    ],
    async ({
      prop,
      table,
      word_table,
      word_spell_link_table,
      word_spell_table
    }) => {
      // ================================================================
      const wordData = {};
      (
        await db.all(
          `select
            ws_lnk_.id_ as id_,
            w_.value_ as value_,
            ws_.value_ as spell_value_
          from ${word_spell_link_table} ws_lnk_
          inner join ${word_table} w_ on w_.id_ = ws_lnk_.word_id_
          inner join ${word_spell_table} ws_ on ws_.id_ = ws_lnk_.spell_id_
          `
        )
      ).forEach((row) => {
        const code = `${row.value_}:${row.spell_value_}`;

        wordData[code] = {
          id_: row.id_
        };
      });

      const linkData = {};
      (await db.all(`select * from ${table}`)).forEach((row) => {
        const code = `${row.phrase_id_}:${row.word_id_}:${row.word_index_}`;

        linkData[code] = {
          ...row,
          __exist__: row
        };
      });

      // ================================================================
      Object.values(phraseMetaMap).forEach((phrase) => {
        const phrase_value = phrase.value_;
        const word_values = phrase.__meta__.value;
        const word_spell_values = phrase.__meta__[prop];

        // 字和读音个数不同，则忽略该词组
        if (
          word_values.length !== word_spell_values.length &&
          word_spell_values.length !== 0
        ) {
          console.log(
            `词组 '${phrase_value}' 的字数与读音数不同(${prop})：${word_spell_values.join(
              ','
            )}`
          );
          return;
        }

        const words = [];
        for (
          let word_value_index = 0;
          word_value_index < word_values.length;
          word_value_index++
        ) {
          const word_value = word_values[word_value_index];
          const word_spell_value = word_spell_values[word_value_index];

          // 字+读音
          const word_code = `${word_value}:${word_spell_value}`;
          const word = wordData[word_code];

          // 对应读音的字不存在，则直接跳过该词组
          if (!word) {
            console.log(
              `词组 '${phrase_value}' 中不存在字 '${word_value}(${word_spell_value})': ${word_spell_values.join(
                ','
              )}`
            );
          } else {
            words.push(word);
          }
        }

        if (words.length !== word_values.length) {
          return;
        }

        // ================================================================
        for (let word_index = 0; word_index < words.length; word_index++) {
          const word = words[word_index];
          const link_code = `${phrase.id_}:${word.id_}:${word_index}`;

          if (!linkData[link_code]) {
            // 新增关联
            linkData[link_code] = {
              phrase_id_: phrase.id_,
              // 与 字的读音关联表 建立联系
              word_id_: word.id_,
              word_index_: word_index
            };
          } else {
            // 关联无需更新
            delete linkData[link_code];
          }
        }
      });

      const missingLinks = [];
      Object.keys(linkData).forEach((code) => {
        const id = linkData[code].id_;

        if (id) {
          // 关联在库中已存在，但未使用
          missingLinks.push(id);

          delete linkData[code];
        }
      });

      await saveToDB(db, table, linkData);
      await removeFromDB(db, table, missingLinks);
    }
  );
}

/** 保存表情符号 */
export async function saveEmojis(db, groupEmojiMetas) {
  // 对表情关键字采取按字（非拼音）匹配策略，
  // 仅关键字与查询字相同时才视为匹配上，可做单字或多字匹配
  await execSQL(
    db,
    `
  create table
    if not exists meta_emoji_group (
      id_ integer not null primary key,
      value_ text not null,
      unique (value_)
    );

  create table
    if not exists meta_emoji (
      id_ integer not null primary key,
      -- 表情符号
      value_ text not null,
      unicode_ text not null,
      unicode_version_ real not null,
      group_id_ interget not null,
      -- 表情关键字中的字 id（meta_word 中的 id）数组列表：二维 json 数组形式
      keyword_ids_list_ text not null,
      unique (value_),
      foreign key (group_id_) references meta_emoji_group (id_)
    );

  -- 表情及其关键字
  create view
    if not exists emoji (
      id_,
      value_,
      unicode_,
      unicode_version_,
      group_,
      keyword_
    ) as
    select
      emo_.id_,
      emo_.value_,
      emo_.unicode_,
      emo_.unicode_version_,
      grp_.value_,
      (select group_concat(word_.value_, '')
        from json_each(emo_.keyword_ids_) word_id_
          inner join meta_word word_
            on word_.id_ = word_id_.value
      )
    from
      (select
          emo_.id_,
          emo_.value_,
          emo_.unicode_,
          emo_.unicode_version_,
          emo_.group_id_,
          json_each.value as keyword_ids_
        from
          meta_emoji emo_,
          json_each(emo_.keyword_ids_list_)
      ) emo_
      left join meta_emoji_group grp_ on grp_.id_ = emo_.group_id_
  order by
    emo_.id_ asc;
`
  );

  const keywordWordData = {};
  (await db.all(`select id_, value_ from meta_word`)).forEach((row) => {
    const code = row.value_;

    keywordWordData[code] = {
      id_: row.id_,
      value_: row.value_
    };
  });

  const emojiGroupMap = Object.keys(groupEmojiMetas).reduce((map, group) => {
    map[group] = { value_: group };

    return map;
  }, {});

  // 保存表情分组信息
  const missingEmojiGroups = [];
  (await db.all('select * from meta_emoji_group')).forEach((row) => {
    const id = row.id_;
    const code = row.value_;

    if (emojiGroupMap[code]) {
      emojiGroupMap[code].id_ = id;
      emojiGroupMap[code].__exist__ = row;
    } else {
      missingEmojiGroups.push(id);
    }
  });
  await saveToDB(db, 'meta_emoji_group', emojiGroupMap);
  await removeFromDB(db, 'meta_emoji_group', missingEmojiGroups);

  // 获取新增表情分组 id
  (await db.all('select * from meta_emoji_group')).forEach((row) => {
    const code = row.value_;

    emojiGroupMap[code].id_ = row.id_;
  });

  const emojiMetaMap = {};
  Object.keys(groupEmojiMetas).forEach((group) => {
    groupEmojiMetas[group].forEach((meta) => {
      meta.keywords = meta.keywords.sort();

      const keyword_ids_list = [];
      meta.keywords.forEach((keyword_value) => {
        const keywords = splitChars(keyword_value);
        const keyword_ids = [];

        keywords.forEach((keyword) => {
          const keyword_id = (keywordWordData[keyword] || {}).id_;

          if (keyword_id) {
            keyword_ids.push(keyword_id);
          } else {
            console.log(
              `表情 '${meta.value}' 的关键字 '${keyword_value}' 不存在字 '${keyword}'`
            );
          }
        });

        if (keyword_ids.length === 0) {
          return;
        }

        keyword_ids_list.push(keyword_ids);
      });

      const code = meta.value;
      emojiMetaMap[code] = {
        __meta__: meta,
        value_: meta.value,
        unicode_: meta.unicode,
        unicode_version_: meta.unicode_version,
        group_id_: emojiGroupMap[group].id_,
        keyword_ids_list_: JSON.stringify(keyword_ids_list)
      };
    });
  });

  // 保存表情信息
  const missingEmojis = [];
  (await db.all('select * from meta_emoji')).forEach((row) => {
    const id = row.id_;
    const code = row.value_;

    if (emojiMetaMap[code]) {
      emojiMetaMap[code].id_ = id;
      emojiMetaMap[code].__exist__ = row;
    } else {
      missingEmojis.push(id);
    }
  });
  await saveToDB(db, 'meta_emoji', emojiMetaMap, true);
  await removeFromDB(db, 'meta_emoji', missingEmojis);

  // 获取新增表情 id
  (await db.all('select * from meta_emoji')).forEach((row) => {
    const code = row.value_;

    emojiMetaMap[code].id_ = row.id_;
  });
}

/** 生成拼音字母组合数据 */
export async function generatePinyinChars(db, file) {
  const values = [];
  const nextCharsMap = {};
  (
    await db.all('select value_ from meta_pinyin_chars order by value_')
  ).forEach((row) => {
    const value = row.value_;
    values.push(value);

    const nextChars =
      value.charAt(1) === 'h' ? value.substring(2) : value.substring(1);
    nextChars && (nextCharsMap[nextChars] = true);
  });

  console.log(
    '- 后继字母列表: ',
    JSON.stringify(Object.keys(nextCharsMap).sort())
  );

  appendLineToFile(file, values.join('\n'), true);
}

/** 生成拼音字母组合数据 */
export async function generatePinyinCharLinks(db, file) {
  const links = {};
  (
    await db.all('select value_ from meta_pinyin_chars order by value_')
  ).forEach((row) => {
    const value = row.value_;
    const chars = splitChars(value);

    if (chars.length > 1) {
      for (let i = 1; i < chars.length; i++) {
        const source = chars[i - 1];
        const target = chars[i];

        (links[source] ||= {})[target] = true;
      }
    }
  });

  const results = [];
  Object.keys(links).forEach((source) => {
    Object.keys(links[source]).forEach((target) => {
      results.push({ source, target });
    });
  });

  appendLineToFile(file, JSON.stringify(results), true);
}

/** 生成拼音字母后继树数据 */
export async function generatePinyinCharTree(db, file) {
  const tree = {};
  (
    await db.all('select value_ from meta_pinyin_chars order by value_')
  ).forEach((row) => {
    const value = row.value_;
    const chars = splitChars(value);

    if (chars.length > 1) {
      let parent = tree;
      let child;

      for (let i = 1; i < chars.length; i++) {
        const source = chars[i - 1];
        const target = chars[i];

        parent = parent[source] ||= {};
        child = parent[target] ||= {};
      }

      child.__is_pinyin__ = true;
    } else {
      const source = chars[0];
      tree[source] = { __is_pinyin__: true };
    }
  });

  const getKeys = (obj) =>
    Object.keys(obj).filter((k) => !k.startsWith('__') && !k.endsWith('__'));
  const traverse = (links, top, level, prefix) => {
    const parent = links[top];

    prefix ||= '';

    const subs = getKeys(parent).sort();
    if (subs.length === 0) {
      return { name: prefix + top, pinyin: true, level };
    }

    if (level > 1) {
      const result = subs
        .reduce((r, sub) => {
          const child = traverse(parent, sub, level + 1);
          if (Array.isArray(child)) {
            r.push(...child.map((c) => top + c.name));
          } else if (typeof child === 'string') {
            r.push(top + child);
          } else {
            r.push(top + child.name);
          }

          return r;
        }, [])
        .concat(parent.__is_pinyin__ ? [top] : [])
        .sort()
        .map((sub) => ({ name: prefix + sub, pinyin: true, level }));

      return result;
    }

    const children = [];
    subs.forEach((sub) => {
      let child;

      if (['c', 's', 'z'].includes(top) && sub === 'h') {
        child = traverse(parent, sub, 0);
      } else {
        child = traverse(parent, sub, level + 1, level > 0 ? top : '');
      }

      if (Array.isArray(child)) {
        children.push(...child);
      } else {
        children.push(child);
      }
    });

    if (parent.__is_pinyin__) {
      return { name: top, pinyin: true, level, children };
    }
    return { name: top, level, children };
  };

  const results = [];
  getKeys(tree).forEach((source) => {
    const child = traverse(tree, source, 0);
    results.push(child);
  });

  appendLineToFile(file, JSON.stringify({ name: '', children: results }), true);
}
