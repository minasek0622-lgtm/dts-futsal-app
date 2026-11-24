// その他：見た目、決まりごと、フットサルのルール、データの控え。
import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { APP_VERSION, exportData, todayISO } from '../lib/store.js';
import { saveBackup } from '../lib/util.js';
import { Confirm, Segmented } from '../ui.jsx';

const HOUSE_RULES = [
  ['コートは必ず5人', 'GK1人とフィールド4人。6人以上いるときは残り全員が休みです。'],
  ['休みの次にGKはなし', '休んだ直後の試合でGKには入りません。'],
  ['GKの次に休みはなし', 'GKをした直後の試合は必ずフィールドで出ます。'],
  ['回数はそろえる', 'GKと休みの回数がなるべく同じになるように、連続の休みもなるべく出ないように組みます。'],
  ['遅れて来た人', '着いた試合から入ります。着いた直後のGKは避け、いなかった間の分をまとめて休ませることもしません。'],
  ['5人に足りないとき', '足りない人数だけ助っ人を入れます。助っ人の1人目がGK、メンバーは全員フィールドです。'],
];

const FUTSAL = [
  ['コートとボール', ['広さは約40m×20m。ゴールは幅3m×高さ2m', 'ボールは4号球で、弾みにくいつくり']],
  ['人数と交代', ['1チーム5人（GK1人＋フィールド4人）', '交代は自由で回数の制限なし。プレー中でも交代ゾーンから入れ替われます']],
  ['試合時間', ['公式戦は前後半20分ずつ（時計を止めて計る）', 'タイムアウトは前後半に1回ずつ、1分間']],
  ['サッカーとの違い', ['オフサイドなし', 'ボールが出たらスローインではなくキックイン。4秒以内に蹴る', 'ゴールキックの代わりに、GKが手で投げて再開', 'GKは自陣で4秒までしかボールを持てません']],
  ['ファウル', ['チームの反則が前後半それぞれ6つ目になると、相手に第2PK（10mから、壁なし）', '退場者が出たチームは2分間、または失点するまで1人少ない人数でプレー']],
];

export default function More({ state, dispatch, toast }) {
  const fileRef = useRef(null);
  const [askReset, setAskReset] = useState(false);
  const [pending, setPending] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.members)) throw new Error('members がありません');
      setPending(data);
    } catch {
      toast('このファイルは読み込めません。書き出した控え（.json）を選んでください');
    }
  };

  return (
    <div className="page page-more">
      <header className="page-head">
        <div>
          <h1>その他</h1>
        </div>
      </header>

      <section className="group">
        <div className="group-row">
          <span>画面の色</span>
          <Segmented
            label="画面の色"
            value={state.theme}
            onChange={(value) => dispatch({ type: 'theme', value })}
            options={[
              { value: 'auto', label: '端末に合わせる' },
              { value: 'light', label: '明るい' },
              { value: 'dark', label: '暗い' },
            ]}
          />
        </div>
      </section>

      <h2 className="section-title">ローテーションの決まり</h2>
      <dl className="rules">
        {HOUSE_RULES.map(([t, d]) => (
          <div key={t}>
            <dt>{t}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>

      <h2 className="section-title">フットサルのルール</h2>
      <div className="accordion">
        {FUTSAL.map(([t, items]) => (
          <details key={t}>
            <summary>{t}</summary>
            <ul>
              {items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <h2 className="section-title">データ</h2>
      <p className="quiet-note">名簿・遅刻回数・記録はこの端末のブラウザの中だけに保存されます。機種変更やブラウザのデータ消去に備えて、ときどき控えを書き出しておくと安心です。</p>
      <div className="data-actions">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={async () => {
            const result = await saveBackup(`futsal-backup-${todayISO()}.json`, exportData(state));
            toast(result === 'saved' ? '控えを書き出しました' : result === 'copied' ? '控えの内容をコピーしました。メモなどに貼り付けて保存してください' : '書き出せませんでした');
          }}
        >
          <Download size={18} />
          控えを書き出す
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => fileRef.current?.click()}>
          <Upload size={18} />
          控えから戻す
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>
      <button type="button" className="link is-danger" onClick={() => setAskReset(true)}>
        すべてのデータを消して最初の状態に戻す
      </button>

      <p className="version">フットサル ローテーション v{APP_VERSION}</p>

      <Confirm
        open={Boolean(pending)}
        title="控えから戻しますか？"
        body={pending ? `いまのデータを、控えの内容（メンバー${pending.members.length}人、記録${(pending.history || []).length}件）で置き換えます。` : ''}
        yes="置き換える"
        onYes={() => {
          dispatch({ type: 'data/replace', data: pending });
          toast('控えから戻しました');
        }}
        onClose={() => setPending(null)}
      />
      <Confirm
        open={askReset}
        title="すべて消しますか？"
        body="名簿、遅刻回数、記録、進行中のローテーションをすべて消します。元には戻せません。"
        yes="すべて消す"
        danger
        onYes={() => {
          dispatch({ type: 'data/reset' });
          toast('最初の状態に戻しました');
        }}
        onClose={() => setAskReset(false)}
      />
    </div>
  );
}
