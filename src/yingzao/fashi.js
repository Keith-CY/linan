// 《营造法式》 (李诫, 1103) rules used by the generator. Pure functions + data, no three.js (node-testable).
//
// Sources: 營造法式 (李誡), read on zh.wikisource.org — 四庫全書本 (營造法式_(四庫全書本)/卷03, 04, 05, 07, 13, 14, 15)
// cross-checked with the punctuated edition (營造法式/第四卷, 第五卷, 第七卷, 第十三卷). Quotes below are from
// those pages (traditional characters). Every number carries the 卷 / section it comes from; where the text gives
// no number we say "approx." and why.
//
// Units: the 大木作 is measured in 分 (材分°): 1 材 is 15 分 high and 10 分 wide, so 1 分 = 材广 / 15.
// Absolute sizes in the text are in 宋尺 / 寸. One Northern-Song official 尺 ≈ 31.2 cm (surviving rulers range
// ~30.9–31.6 cm); we use CHI = 0.312 m, 1 寸 = CHI / 10.

export const CHI = 0.312;       // metres per 宋尺 (approx., see above)
export const CUN = CHI / 10;    // metres per 寸

// ---------------------------------------------------------------- 材 (卷四 大木作制度一 · 材)
// "凡構屋之制，皆以材為祖。材有八等，度屋之大小，因而用之。"
// "各以其材之廣，分為十五分，以十分為其厚。"
// 栔: "栔廣六分，厚四分。材上加栔者謂之足材。"
export const CAI_GRADES = [
  null,
  { grade: 1, guang: 9.0, hou: 6.0, use: '殿身九間至十一間則用之' },
  { grade: 2, guang: 8.25, hou: 5.5, use: '殿身五間至七間則用之' },
  { grade: 3, guang: 7.5, hou: 5.0, use: '殿身三間至殿五間或堂七間則用之' },
  { grade: 4, guang: 7.2, hou: 4.8, use: '殿三間，廳堂五間則用之' },
  { grade: 5, guang: 6.6, hou: 4.4, use: '殿小三間，廳堂大三間則用之' },
  { grade: 6, guang: 6.0, hou: 4.0, use: '亭榭或小廳堂皆用之' },
  { grade: 7, guang: 5.25, hou: 3.5, use: '小殿及亭榭等用之' },
  { grade: 8, guang: 4.5, hou: 3.0, use: '殿內藻井或小亭榭施鋪作多則用之' },
]; // 材廣 / 厚 in 寸 (卷四 · 材: 第一等 廣九寸厚六寸 … 第八等 廣四寸五分厚三寸)

export const CAI = 15;      // 單材 height (分)
export const CAI_HOU = 10;  // 材 thickness (分)
export const QI = 6;        // 栔 height (分), 卷四 · 材
export const ZUCAI = 21;    // 足材 = 材 + 栔 (分)

/** metres per 分 for a 材 grade: 材廣 (寸) / 15 */
export function fenOf(grade) {
  const g = CAI_GRADES[grade];
  if (!g) throw new Error('材 grade must be 1..8');
  return (g.guang * CUN) / CAI;
}

// ---------------------------------------------------------------- 栱 (卷四 · 栱)
// lengths in 分; 卷殺: 瓣 count and 瓣 length (分): "華栱…長七十二分…每頭以四瓣卷殺，每瓣長四分";
// "泥道栱…長六十二分…每頭以四瓣卷殺，每瓣長三分半"; "瓜子栱…長六十二分…每頭以四瓣卷殺，每瓣長四分";
// "令栱…長七十二分…每頭以五瓣卷殺，每瓣長四分"; "慢栱…長九十二分…每頭以四瓣卷殺，每瓣長三分".
// "凡栱之廣厚並如材。栱頭上留六分，下殺九分；其九分勻分為四大分；又從栱頭順身量為四瓣…"
export const GONG = {
  hua: { len: 72, ban: 4, banLen: 4, zu: true },     // 華栱 (足材)
  nidao: { len: 62, ban: 4, banLen: 3.5, zu: false }, // 泥道栱
  guazi: { len: 62, ban: 4, banLen: 4, zu: false },   // 瓜子栱
  ling: { len: 72, ban: 5, banLen: 4, zu: false },    // 令栱
  man: { len: 92, ban: 4, banLen: 3, zu: false },     // 慢栱
};
export const GONG_TOP_KEEP = 6;  // 栱頭上留六分
export const GONG_CUT = 9;       // 下殺九分

// ---------------------------------------------------------------- 枓 (卷四 · 枓)
// 櫨枓: "長廣各三十二分。若施於角柱之上者，方三十六分。…高二十分；上八分為耳，中四分為平，下八分為欹。…底四面各殺四分，欹䫜一分"
// 交互枓: "長十八分，廣十六分" ; 齊心枓: "長與廣皆十六分" ; 散枓: "長十六分，廣十四分" ;
// "凡交互枓、齊心枓、散枓，皆高十分；上四分為耳，中二分為平，下四分為欹。…底四面各殺二分，欹䫜半分"
export const DOU = {
  lu: { l: 32, w: 32, er: 8, ping: 4, qi: 8, sha: 4 },
  luCorner: { l: 36, w: 36, er: 8, ping: 4, qi: 8, sha: 4 },
  jiaohu: { l: 18, w: 16, er: 4, ping: 2, qi: 4, sha: 2 },
  qixin: { l: 16, w: 16, er: 4, ping: 2, qi: 4, sha: 2 },
  san: { l: 16, w: 14, er: 4, ping: 2, qi: 4, sha: 2 },
};

// ---------------------------------------------------------------- 鋪作 (卷四 · 總鋪作次序)
// "出一跳謂之四鋪作，出二跳謂之五鋪作，出三跳謂之六鋪作，出四跳謂之七鋪作，出五跳謂之八鋪作。"
// "凡鋪作逐跳上安栱，謂之計心；…" ; 出跳: "每跳之長，心不過三十分；傳跳雖多，不過一百五十分。"
// 補間: "當心間須用補間鋪作兩朵，次間及梢間各用一朵。其鋪作分布，令遠近皆勻。"
// Standard combinations (卷四 · 飛昂, 卷十七/十八 功限): 五鋪作 單杪單昂, 六鋪作 單杪雙昂, 七鋪作 雙杪雙昂, 八鋪作 雙杪三昂.
export const TIAO = 30;  // 分 per 跳 (卷四 · 栱 · 華栱: "每跳之長，心不過三十分；傳跳雖多，不過一百五十分"), used as the standard
// 下昂 (卷四 · 飛昂): "一曰下昂：自上一材，垂尖向下，從枓底心下取直，其長二十三分（其昂身上徹屋內）。自枓外斜殺向下，留厚二分；
//   昂面中䫜二分，令䫜勢圜和。亦有於昂面上隨䫜加一分，訛殺至兩棱者，謂之琴面昂" ; "凡昂安枓處，高下及遠近皆準一跳" ;
//   "凡昂上坐枓，四鋪作、五鋪作並歸平；六鋪作以上，自五鋪作外，昂上枓並再向下二分至五分" ; "若昂身於屋內上出，皆至下平槫".
// The text gives no slope: we take 23° (Song examples run ~21–26°).
export const ANG = { tip: 23, slopeDeg: 23, dropAbove5: 3.5 };
export function puzuoTiers(puzuo, { ang = true } = {}) {
  const n = puzuo - 3; // 跳 count
  if (n < 1 || n > 5) throw new Error('鋪作 must be 4..8');
  // per 跳: 'hua' (杪 = 華栱) or 'ang' (下昂)
  const combos = { 1: ['hua'], 2: ['hua', 'ang'], 3: ['hua', 'ang', 'ang'], 4: ['hua', 'hua', 'ang', 'ang'], 5: ['hua', 'hua', 'ang', 'ang', 'ang'] };
  return ang ? combos[n] : new Array(n).fill('hua');
}

// ---------------------------------------------------------------- 柱 (卷五 · 柱)
// 柱徑: "若殿閣，即徑兩材兩栔至三材；若廳堂柱即徑兩材一栔；餘屋即徑一材一栔至兩材。"
// 生起: "至角則隨間數生起角柱。若十三間殿堂，則角柱比平柱生高一尺二寸；十一間生高一尺；九間生高八寸；
//        七間生高六寸；五間生高四寸；三間生高二寸。"
// 側脚: "凡立柱，並令柱首微收向內，柱腳微出向外，謂之側腳。每屋正面，隨柱之長，每一尺即側腳一分；
//        若側面，每長一尺即側腳八釐。至角柱，其柱首相向各依本法。"
// 梭柱: "凡殺梭柱之法：隨柱之長，分為三分，上一分又分為三分，如栱卷殺，漸收至上徑比櫨枓底四周各出四分；
//        又量柱頭四分，緊殺如覆盆樣，令柱頭與櫨枓底相副。"
export function columnDiameter(type) { return type === 'diange' ? 2 * ZUCAI : type === 'tingtang' ? 2 * CAI + QI : CAI + QI; } // 分 (殿閣 lower bound 42)
// 亭榭 are not named in the 柱 rule; we give them the 餘屋 upper bound (兩材 = 30 分), approx.
export const TING_COLUMN_FEN = 2 * CAI;
export function shengqiCun(bays) {
  const t = { 13: 12, 11: 10, 9: 8, 7: 6, 5: 4, 3: 2 };
  return t[bays] ?? Math.max(0, (bays - 1)); // 寸, corner column rise over the 平柱
}
export const CEJIAO_FRONT = 0.01;   // 每一尺側腳一分 = 1/100
export const CEJIAO_SIDE = 0.008;   // 每長一尺側腳八釐 = 0.8/100

// ---------------------------------------------------------------- 闌額 (卷五 · 闌額)
// "造闌額之制：廣加材一倍，厚減廣三分之一，長隨間廣，兩頭至柱心。"  → 30 分 × 20 分
export const LANE = { h: 30, w: 20 };
// 普拍方: the 法式 sizes it only under 平坐 (卷四 · 平坐: "凡平坐鋪作下用普拍方，厚隨材廣，或更加一栔；其廣盡所用方木").
// Song halls (晉祠聖母殿, 隆興寺) also carry one over the 闌額 under the 櫨枓. approx.: 15 分 thick, 30 分 wide.
export const PUPAI = { h: 15, w: 30 };
// 橑檐方: approx. 30 分 high × 12 分 (卷五 · 橑檐方 sizes it "廣加材一倍" for 殿閣; thickness approx.)
export const LIAOYAN = { h: 30, w: 12 };

// ---------------------------------------------------------------- 椽 / 檐 (卷五 · 椽, · 檐)
// 椽徑: "若殿閣，徑九分至十分；若廳堂，椽徑七分至八分；餘屋，徑六分至七分。"
// 椽平長: "每架平不過六尺。若殿閣，或加五寸至一尺五寸。"
// 布椽: "其稀密以兩椽心相去之廣為法：殿閣廣九寸五分至九寸；副階廣九寸至八寸五分；廳堂廣八寸五分至八寸；
//        廊庫屋廣八寸至七寸五分。"
// 檐出: "造檐之制：皆從橑檐方心出，如椽徑三寸，即檐出三尺五寸；椽徑五寸，即檐出四尺至四尺五寸。"
// 飛子: "檐外別加飛檐。每檐一尺，出飛子六寸。" ; "凡飛子如椽徑十分則廣八分厚七分" (0.8 × 0.7 of the 椽徑);
//        "若近角飛子隨勢上曲，令背與小連檐平".
// 翼角生出: "其檐自次角柱補間鋪作心，椽頭皆生出向外，漸至角梁：若一間生四寸；三間生五寸；五間生七寸。
//           （五間以上，約度隨宜加減。）其角柱之內，檐身亦令微殺向裏。"
export function rafterDiameter(type) { return type === 'diange' ? 10 : type === 'tingtang' ? 8 : 7; } // 分
export function rafterSpacingCun(type) { return type === 'diange' ? 9.25 : type === 'tingtang' ? 8.25 : 7.75; } // 寸
/** 檐出 (m) from the 橑檐方 centre for a rafter diameter (m): linear between the two cases the text gives */
export function eaveOut(rafterDiaM) {
  const d = rafterDiaM / CUN; // 寸
  const chi = d <= 3 ? 3.5 * (d / 3) : 3.5 + ((d - 3) / 2) * (4.25 - 3.5); // 3寸→3.5尺, 5寸→4–4.5尺 (we take 4.25)
  return chi * CHI;
}
export const FEIZI_RATIO = 0.6; // 每檐一尺出飛子六寸
export const FEIZI_SECTION = { w: 0.8, h: 0.7 }; // × 椽徑 (卷五 · 檐)
export function shengchuCun(bays) { return bays <= 1 ? 4 : bays <= 3 ? 5 : bays <= 5 ? 7 : 7 + (bays - 5); }

// ---------------------------------------------------------------- 舉折 (卷五 · 舉折)
// 舉屋之法 ("撩檐方" in the 四庫 text): "如殿閣樓臺，先量前後橑檐方心相去遠近，分為三分（若餘屋柱梁作或不出跳者，則用前後檐柱心），
//   從橑檐方背至脊槫背舉起一分。如甋瓦廳堂，即四分中舉起一分，又通以四分所得丈尺，每一尺加八分。
//   若甋瓦廊屋及瓪瓦廳堂，每一尺加五分；或瓪瓦廊屋之類，每一尺加三分。"
// 折屋之法: "以舉高尺丈，每尺折一寸，每架自上遞減半為法。如舉高二丈，即先從脊槫背上取平，下屋橑檐方背，
//   其上第一縫折二尺；又從上第一縫槫背取平，下至橑檐方背，於第二縫折一尺；若椽數多，即逐縫取平，
//   皆下至橑檐方背，每縫並減上縫之半。"
/** 舉高 (same unit as D) for the front–back 橑檐方 distance D. `rule` is a 法式 case or a number (舉高 / D). */
export function juHeight(D, rule) {
  if (typeof rule === 'number') return D * rule;
  if (rule === 'diange') return D / 3;
  if (rule === 'tingtang') return (D / 4) * 1.08;     // 甋瓦廳堂
  if (rule === 'tingtang-ban' || rule === 'lang') return (D / 4) * 1.05; // 瓪瓦廳堂 / 甋瓦廊屋
  return (D / 4) * 1.03;                              // 瓪瓦廊屋 ('wu')
}
// Roof pitch actually used: the 殿閣 rule (D / 3) gives a top 折 of ~44° and reads steeper than the
// Southern-Song halls the references show. Every building defaults to the 廳堂 rule of the same section
// ("如甋瓦廳堂，即四分中舉起一分，又通以四分所得丈尺，每一尺加八分": 舉高 = 0.27 D, average pitch ~28°), which
// the text gives for 甋瓦 roofs and which sits with the flatter pitch of surviving Northern-Song halls. A building
// may still ask for ju: 'diange' or for a measured ratio (ju: 0.30). We could not check published survey figures
// for 晉祠聖母殿 / 隆興寺摩尼殿 here, so no measured number is claimed.
export const JU_DEFAULT = 'tingtang';

// 鬬尖 (攢尖) 亭榭 (卷五 · 舉折): "若八角或四角鬬尖亭榭，自橑檐方背舉至角梁底，五分中舉一分，至上簇角梁，
//   即兩分中舉一分。（若亭榭只用瓪瓦者，即十分中舉四分。）" ; 簇角梁 (卷五 · 陽馬): "簇角梁之法：用三折".
// We read it as: over the 橑檐方-to-橑檐方 span D, the 大角梁 end (half way in) stands D / 5 above the 橑檐方背 and the
// 棖桿 (apex) D / 2; the middle 折 of the 簇角梁 is let down by one tenth of the rise. Measured along the apothem,
// not the diagonal (approx.: the text does not say along which line).
export function cuanjianNodes(R) {
  // R = apothem of the 橑檐方 polygon; D = 2R
  const D = 2 * R, H = D / 2;
  const n1 = { d: R / 2, y: D / 5 };
  const yLine = n1.y + (H - n1.y) * 0.5;
  return [{ d: 0, y: 0 }, n1, { d: R * 0.75, y: yLine - H / 10 }, { d: R, y: H }];
}
/**
 * 折屋: purlin heights along one slope.
 * @param {number[]} xs horizontal distances from the ridge of every 槫縫, ridge first (xs[0] = 0) and the
 *                      橑檐方 last; the inner ones are the 縫 that get a 折
 * @param {number} H 舉高 (ridge 槫背 above 橑檐方背)
 * @returns {number[]} heights above the 橑檐方背, same order
 */
export function zheWu(xs, H) {
  const n = xs.length, X = xs[n - 1];
  const ys = new Array(n);
  ys[0] = H; ys[n - 1] = 0;
  let f = H / 10; // 每尺折一寸 → first 折 = 舉高 / 10
  for (let i = 1; i < n - 1; i++) {
    // straight line from the previous 縫 (取平) down to the 橑檐方背, then lower this 縫 by f
    const x0 = xs[i - 1], y0 = ys[i - 1];
    const yLine = y0 * (X - xs[i]) / (X - x0);
    ys[i] = yLine - f;
    f /= 2; // 每縫並減上縫之半
  }
  return ys;
}

// ---------------------------------------------------------------- 平坐 (卷四 · 平坐)
// "造平坐之制：其鋪作減上屋一跳或兩跳。其鋪作宜用重栱及逐跳計心造作。"
// "凡平坐鋪作，若叉柱造，即每角用櫨枓一枚，其柱根叉於櫨枓之上。若纏柱造，即每角於柱外普拍方上安櫨枓三枚。"
// "凡平坐先自地立柱，謂之永定柱；柱上安搭頭木，木上安普拍方；方上坐枓栱。"
// The floor edge carries a 鴈翅版 fascia (卷四 · 平坐: "鴈翅版廣加材一倍，厚四分至五分") and the 勾闌.
export const YANCHIBAN = { h: 30, w: 4.5 }; // 分
/** 平坐 鋪作 count: one 跳 fewer than the storey above (2 fewer for 七鋪作 and up), never under 四鋪作 */
export function pingzuoPuzuo(puzuoAbove) { return Math.max(4, puzuoAbove - (puzuoAbove >= 7 ? 2 : 1)); }

// ---------------------------------------------------------------- 勾闌 (卷八 小木作 · 鉤闌 ; 卷三 石作 · 重臺鉤闌)
// 卷八: "造樓閣殿亭鉤闌之制有二：一曰重臺鉤闌，高四尺至四尺五寸；二曰單鉤闌，高三尺至三尺六寸。若轉角則用望柱。
//        （或不用望柱，即以尋杖絞角。）"
// 卷三 (stone): "重臺鉤闌每段高四尺，長七尺。尋杖下用雲栱、癭項，次用盆脣，中用束腰，下施地栿。…
//        單鉤闌每段高三尺五寸，長六尺。上用尋杖，中用盆脣，下用地栿。其盆脣、地栿之內作萬字…"
// Member sizes are given per 尺 of height in tables we did not transcribe; ours are approx. (望柱 ~ 0.09 h square,
// 尋杖 ~ 0.05 h round, 盆脣 / 地栿 ~ 0.06 h).
export const GOULAN = {
  dan: { hChi: 3.3, panelChi: 6 },      // 單鉤闌 (wood 3–3.6 尺; stone 每段 3.5 尺 high, 6 尺 long)
  chongtai: { hChi: 4.0, panelChi: 7 }, // 重臺鉤闌 (stone 每段高四尺，長七尺)
};

// ---------------------------------------------------------------- 瓦 at the eave (卷十三 瓦作 · 結瓷)
// The eave ends of the rows are 華頭甋瓦 (勾頭: the round 甋瓦 with a face, 瓦當) and, between them, 重脣瓪瓦 (滴水:
// the 瓪瓦 with a thickened, hanging lip). The 法式 gives no size for the faces; ours follow the 甋瓦 / 瓪瓦 widths of
// tileSizeCun (approx.: face = 甋瓦 diameter, lip drop = 0.45 × 甋瓦 diameter).
// 獸 (卷十三 · 用獸頭等): 嬪伽 at the tip of each 角脊, 蹲獸 behind it "每隔三瓦或五瓦安獸一枚"; counts by size approx.
export function dunshouCount(bays) { return bays >= 9 ? 8 : bays >= 5 ? 4 : 2; }

// ---------------------------------------------------------------- 磚 (卷十五 磚作 · 用磚)
// 條磚 "長一尺三寸，廣六寸五分，厚二寸五分" → courses of 2.5 寸 + joint (pagoda bodies, 墩台, 階基 facing).
export const BRICK_CUN = { l: 13, w: 6.5, h: 2.5 };

// ---------------------------------------------------------------- 塔 (pagodas)
// The 法式 has no chapter on pagodas. Our pagodas reuse the hall rules storey by storey (材分, 鋪作, 腰檐 = one 檐
// on 檐椽 at the storey's 舉折 eave slope, 平坐 per 卷四) and take their overall proportions from surviving
// southern brick-and-timber towers (approx.): each storey's column ring is set in 0.06–0.1 of the one below
// (收分), storey heights fall by ~6 % per storey, and the 塔刹 is ~1/6 of the total height.

// ---------------------------------------------------------------- 角梁 / 出際 / 搏風版 (卷五)
// 廈兩頭: "凡廳堂若廈兩頭造，則兩梢間用角梁轉過兩椽。（亭榭之類轉一椽。今亦用此制為殿閣者，俗謂之曹殿，又曰漢殿，亦曰九脊殿。）"
// 出際: "凡出際之制：槫至兩梢間，兩際各出柱頭。如兩椽屋，出二尺至二尺五寸；四椽屋，出三尺至三尺五寸；
//        六椽屋，出三尺五寸至四尺；八椽至十椽屋，出四尺五寸至五尺。若殿閣轉角造，即出際長隨架。"
// 搏風版: "造搏風版之制：於屋兩際出槫頭之外安搏風版，廣兩材至三材，厚三分至四分，長隨架道。"
// 角梁: "大角梁，其廣二十八分至加材一倍；厚十八分至二十分。…子角梁，廣十八分至二十分，厚減大角梁三分。"
export function chujiChi(rafters) { return rafters <= 2 ? 2.25 : rafters <= 4 ? 3.25 : rafters <= 6 ? 3.75 : 4.75; }
export const BOFENG = { h: 36, w: 3.5 }; // 搏風版 廣兩材至三材 (30–45 分, we take 36), 厚三分至四分
export const JIAOLIANG = { da: { h: 28, w: 19 }, zi: { h: 19, w: 16 } };
// 起翹 (corner lift of the eave): the 法式 has no word or number for it. It follows from 卷五 · 棟:
// "凡兩頭梢間槫背上並安生頭木，廣厚並如材，長隨梢間，斜殺向裏，令生勢圜和…其轉角者，高與角梁背平，或隨宜加高，
//  令椽頭背低角梁頭背一椽分" — the purlins rise by a 生頭木 (材廣 15 分) toward the corner, and the rafter ends
// stay one 椽徑 below the 角梁 head; the 子角梁 head adds its 上折 (7 分). We sum these: 15 + 10 + 7 = 32 分.
export const QIQIAO_FEN = 15 + 10 + 7;

// ---------------------------------------------------------------- 瓦作 (卷十三)
// 用瓦: "殿閣廳堂等，五間以上，用甋瓦長一尺四寸，廣六寸五分。仰瓪瓦長一尺六寸，廣一尺。三間以下，用甋瓦長一尺二寸，
//        廣五寸。仰瓪瓦長一尺四寸，廣八寸。"
// 壘屋脊: "殿閣，若三間八椽或五間六椽，正脊高三十一層，垂脊低正脊兩層。堂屋，若三間八椽或五間六椽，正脊高二十一層。
//         廳屋，若間、椽與堂等者，正脊減堂脊兩層。" ; "凡壘屋脊，每增兩間或兩椽，則正脊加兩層（殿閣加至三十七層止…）"
//         ; "正脊於線道瓦上厚一尺至八寸，垂脊減正脊二寸（正脊十分中上收二分，垂脊上收一分）"
//         (one 層 = one course of 瓪瓦 laid flat; approx. 0.6 寸 with its mortar)
// 獸頭: "殿閣垂脊獸並以正脊層數為祖：正脊三十七層者獸高四尺，三十五層者三尺五寸，三十三層者三尺，三十一層者二尺五寸"
// 走獸: "每隔三瓦或五瓦安獸一枚" (on the 角脊).
// 鴟尾: "殿屋八椽九間以上，其下有副階者，鴟尾高九尺至一丈；無副階者高八尺；五間至七間，高七尺至七尺五寸；
//        三間高五尺至五尺五寸。樓閣三層檐者與殿五間同；兩層檐者與殿三間同。殿挾屋高四尺至四尺五寸。
//        廊屋之類，並高三尺至三尺五寸。"
//        smaller buildings (卷十三 · 用瓦, continued): "散屋用甋瓦長九寸，廣三寸五分…小亭榭之類，柱心相去方一丈以上者，
//        用甋瓦長八寸，廣三寸五分…若方一丈者，用甋瓦長六寸，廣二寸五分…" (the matching 仰瓪瓦 we take at ~1.7 × the 甋瓦
//        width and 1.25 × its length, approx.)
export function tileSizeCun(bays, cls = null) {
  if (cls === 'ting') return { tong: { l: 8, w: 3.5 }, ban: { l: 10, w: 6 } };
  if (cls === 'sanwu') return { tong: { l: 9, w: 3.5 }, ban: { l: 12, w: 6.5 } };
  return bays >= 5 ? { tong: { l: 14, w: 6.5 }, ban: { l: 16, w: 10 } } : { tong: { l: 12, w: 5 }, ban: { l: 14, w: 8 } };
}
export function ridgeCourses(type, bays, rafters) {
  // base case 三間八椽 / 五間六椽; "每增兩間或兩椽，則正脊加兩層" (and fewer for smaller halls, approx.)
  const extra = Math.round(((bays - 3) + (rafters - 8)) / 2) * 2;
  if (type === 'diange') return Math.min(37, Math.max(21, 31 + extra));
  if (type === 'tingtang') return Math.min(25, Math.max(13, 19 + extra)); // 廳屋 = 堂 21 層 減兩層
  return Math.min(11, Math.max(5, 9 + extra));
}
export function ridgeWidthChi(courses) { return courses >= 31 ? 1.0 : 0.8 + 0.2 * Math.max(0, (courses - 21) / 10); } // 厚一尺至八寸
export function beastChi(courses) { return courses >= 37 ? 4 : courses >= 35 ? 3.5 : courses >= 33 ? 3 : courses >= 31 ? 2.5 : 2; }
export const RIDGE_COURSE_CUN = 0.6; // approx. thickness of one 瓪瓦 course with its mortar bed (寸)
// 正脊 ends: 鴟尾 belong to 殿 and 樓閣 (卷十三 · 用鴟尾 lists 殿屋, 樓閣, 殿挾屋, 廊屋); 堂屋 / 廳堂 carry a 獸頭 on
// the ridge end instead (卷十三 · 用獸頭等: "堂屋等正脊獸，亦以正脊層數為祖"). We size that 獸 from the ridge courses
// like the 殿閣 垂脊獸 (beastChi), approx.
export function ridgeEndKind(type, storeys = 1) { return type === 'diange' || storeys > 1 ? 'chiwei' : type === 'tingtang' ? 'beast' : 'plain'; }
export function chiweiChi(bays, { fujie = false, rafters = 8, storeys = 1 } = {}) {
  if (storeys === 3) return 7.25;          // 樓閣三層檐者與殿五間同
  if (storeys === 2) return 5.25;          // 兩層檐者與殿三間同
  if (bays >= 9 && rafters >= 8) return fujie ? 9.5 : 8;
  if (bays >= 5) return 7.25;              // 五間至七間 七尺至七尺五寸
  if (bays >= 3) return 5.25;              // 三間 五尺至五尺五寸
  return 2.75;                             // 小亭殿等 二尺五寸至三尺
}

// ---------------------------------------------------------------- 階基 / 踏道 / 柱礎 (卷三, 卷十五)
// 立基 (卷三 壕寨制度 · 立基): "立基之制，其高與材五倍。（材分在大木作制度內）如東西廣者，又加五分至十分。"
// 階頭 (卷十五 磚作 · 壘階基): "…普拍方外階頭自柱心出三尺至三尺五寸"
// 踏道 (卷三 石作 · 踏道): "造踏道之制：長隨間之廣。每階高一尺作二踏；每踏厚五寸，廣一尺。兩邊副子，各廣一尺八寸。"
// 柱礎 (卷三 石作 · 柱礎): "造柱礎之制：其方倍柱之徑。…若造覆盆，每方一尺，覆盆高一寸；每覆盆高一寸，盆脣厚一分。"
export function platformHeightCun(grade) { return CAI_GRADES[grade].guang * 5; }
export const STEP = { riseCun: 5, treadCun: 10, fuziCun: 18 };
export const PLATFORM_OUT_CHI = 3.5; // 階頭自柱心出三尺至三尺五寸 (we take the upper value for a 殿)

// ---------------------------------------------------------------- 門窗 (卷六/卷七 小木作)
// 格子門 (卷七): "每間分作四扇（如梢間狹促者，只分作二扇）" ; 破子櫺窗 (卷六): "每間廣一丈，用十七櫺"
export const DOOR_LEAVES = 4;
export function windowBars(widthM) { return Math.max(7, Math.round((widthM / (10 * CHI)) * 17) | 1); }

// ---------------------------------------------------------------- 彩畫 (卷十四 · 丹粉刷飾屋舍)
// "丹粉刷飾屋舍之制：應材木之類，面上用土朱通刷，下棱用白粉闌界緣道（兩盡頭斜訛向下），下面用黃丹通刷
//  （昂栱下面及耍頭正面同）" ; "枓栱之類…隨材之廣分為八分，以一分為白緣道。其廣雖多不得過一寸，雖狹不得過五分"
//  ; "柱頭刷丹（柱腳同）…柱身、椽、檩及門窗之類，皆通刷土朱" ; 闌額: 七朱八白.
// We paint this restrained scheme: 土朱 faces, white lower-edge lines (材廣/8), 黃丹 undersides, 七朱八白 on the 闌額.
export function whiteLineM(fen) { return Math.min(CUN, Math.max(0.5 * CUN, (CAI * fen) / 8)); }
