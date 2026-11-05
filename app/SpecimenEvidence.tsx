'use client';
import {useEffect, useId, useState} from 'react';
import {getSpecies, type SpeciesId} from '../lib/species';
import {
  ncStateSource, referenceAssetUrl, selectReferencePhotos, specimenEvidence,
  specimenMaterialPriors, unsolvedProcesses, type ReferencePhoto,
} from '../lib/specimen-evidence';
import './specimen-evidence.css';

function Photo({photo, name}: {photo: ReferencePhoto; name: string}) {
  const [failed, setFailed] = useState(false);
  return <figure className="se-photo">
    {failed ? <div className="se-photo-fallback">照片暂不可用<a href={photo.original} target="_blank" rel="noreferrer">查看原始照片 ↗</a></div> :
      <a className="se-photo-link" href={photo.original} target="_blank" rel="noreferrer">
        <img src={referenceAssetUrl(import.meta.env.BASE_URL, photo.file)} alt={`${name}物种形态参考照片；非云谷个体；摄影：${photo.author}`} loading="lazy" decoding="async" onError={() => setFailed(true)}/>
      </a>}
    <figcaption><strong>{name} · 物种照片</strong><span>{photo.author} · {photo.license}</span>
      <details><summary>署名、许可与原始来源</summary><div className="se-photo-credits">
        <span>摄影：{photo.author}</span>
        <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license} 许可 ↗</a>
        <a href={photo.original} target="_blank" rel="noreferrer">原始图片 ↗</a>
        <a href={photo.source} target="_blank" rel="noreferrer">图片来源页面 ↗</a>
        <span>物种形态参考，非云谷个体照片；等比显示。</span>
      </div></details>
    </figcaption>
  </figure>;
}

export default function SpecimenEvidence({speciesId, age}: {speciesId: SpeciesId; age: number}) {
  const headingId = useId();
  const sp = getSpecies(speciesId), evidence = specimenEvidence[speciesId];
  const [catalog, setCatalog] = useState<unknown>(null);
  const [photoState, setPhotoState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPhotoState('loading');
    fetch(referenceAssetUrl(import.meta.env.BASE_URL, 'photo-attribution.json'), {signal: controller.signal})
      .then(response => { if (!response.ok) throw new Error('Photo catalog unavailable'); return response.json(); })
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error('Invalid photo catalog');
        if (!controller.signal.aborted) { setCatalog(data); setPhotoState('ready'); }
      })
      .catch(() => { if (!controller.signal.aborted) setPhotoState('error'); });
    return () => controller.abort();
  }, [request]);
  const photos = selectReferencePhotos(catalog, speciesId);
  const material = specimenMaterialPriors(speciesId, age);
  const ageLabel = Number.isFinite(age) && age >= 0 ? `${Number(age.toFixed(2))} 年` : '年龄无效';

  return <section className="specimen-evidence" aria-labelledby={headingId}>
    <header className="se-header"><div><span className="se-kicker">SPECIMEN / EVIDENCE</span>
      <h2 id={headingId}>{sp.name}：从物种证据到形态模型</h2><p><i>{sp.latin}</i> · {sp.type}</p></div>
      <span className="se-badge">物种参考 · 非个体重建</span>
    </header>

    <div className="se-reference-grid">
      <div className="se-reference-intro"><h3>真实照片，对照器官</h3><p>照片只用于辨识物种形态，不代表云谷个体、当前年龄或实测尺度。</p>
        <a href={ncStateSource(speciesId)} target="_blank" rel="noreferrer">NC State 原始物种页面 ↗</a>
      </div>
      <div className="se-gallery" aria-label={`${sp.name}参考照片`}>
        {photoState === 'ready' && photos.map(photo => <Photo key={`${speciesId}:${photo.file}`} photo={photo} name={sp.name}/>)}
        {(photoState !== 'ready' || photos.length === 0) && <div className="se-empty" role="status">
          <strong>{photoState === 'loading' ? '正在读取照片归属记录…' : photoState === 'error' ? '照片归属记录暂不可用' : `${sp.name}暂无本地授权参考照片`}</strong>
          <p>{photoState === 'error' ? '可通过原始物种页面查看照片及署名。' : '物种资料与原图署名可在来源页面查看。'}</p>
          <a href={ncStateSource(speciesId)} target="_blank" rel="noreferrer">查看{sp.name}原始来源 ↗</a>
          {photoState === 'error' && <button type="button" onClick={() => setRequest(value => value + 1)}>重试照片目录</button>}
        </div>}
      </div>
    </div>

    <div className="se-block"><div className="se-block-heading"><h3>器官差异</h3><span>形态：文献约束 / 几何：工程表达</span></div>
      <div className="se-table-scroll" role="region" aria-label={`${sp.name}器官差异表，可横向滚动`} tabIndex={0}><table>
        <caption className="se-sr-only">{sp.name}文献形态与当前模型表达对照</caption>
        <thead><tr><th scope="col">器官</th><th scope="col">物种形态 · 文献约束</th><th scope="col">当前几何表达 · 未校准</th></tr></thead>
        <tbody>{evidence.organs.map(row => <tr key={row.organ}><th scope="row">{row.organ}</th><td>{row.literature}</td><td>{row.model}</td></tr>)}</tbody>
      </table></div>
    </div>

    <div className="se-block"><div className="se-block-heading"><h3>建立过程</h3><span>输入年龄 {ageLabel} · 工程时间轴</span></div>
      <ol className="se-stages">{evidence.establishment.map((stage, index) => <li key={stage}><span>{String(index + 1).padStart(2, '0')}</span><p>{stage}</p></li>)}</ol>
      <p className="se-note">阶段表示器官建立顺序；年龄、出现阈值与生长速度均未校准，不推断繁殖成熟或寿命。{speciesId === 'ophiopogon' ? '麦冬从新营养分株建立计时。' : '苗木来源、移植与修剪会改变过程。'}</p>
    </div>

    <div className="se-status-grid">
      <article><span className="se-label">已实现 · 几何代理</span><p>{evidence.implemented}</p><p className="se-note">可用风载、重力与等效梁响应观察形变；根系为程序化示意。</p></article>
      <article className="se-pending"><span className="se-label">未实现 / 待校准</span><p>{evidence.remaining}</p><ul className="se-processes">{unsolvedProcesses.map(process => <li key={process}>{process}：未完整求解</li>)}</ul></article>
    </div>

    <details className="se-details"><summary>材料先验 · 未校准工程数值<span>查看参数与单位</span></summary>
      <p className="se-note">读取当前物种与输入年龄对应的 physicalPriors 基线；刚度倍率为 1×。材性按木本 / 草本角色设定，未做物种材料试验，也未测量云谷个体。</p>
      {material ? <dl className="se-materials">
        <div><dt>等效弹性模量 E</dt><dd>{Number((material.youngModulusPa / 1e9).toFixed(3))} GPa</dd></div>
        <div><dt>组织等效密度 ρ</dt><dd>{material.woodDensityKgM3} kg/m³</dd></div>
        <div><dt>叶面积质量</dt><dd>{material.leafArealMassKgM2} kg/m²</dd></div>
        <div><dt>风阻系数 Cᴅ</dt><dd>{material.dragCoefficient}（无量纲）</dd></div>
        <div><dt>阻尼比 ζ</dt><dd>{material.dampingRatio}（无量纲）</dd></div>
      </dl> : <p className="se-note">请提供有限、非负的年龄以查看材料先验。</p>}
      <p className="se-note">{material?.note}。叶厚、根深、根长及土壤响应也不能当作实测值。</p>
    </details>

    <details className="se-details"><summary>展开来源与证据边界<span>植物学 / 照片 / 校园</span></summary>
      <ul className="se-sources">
        <li><a href={sp.source} target="_blank" rel="noreferrer">{sp.name}植物学来源 ↗</a><span>项目 species / additional-species-data 中的物种资料；支持形态约束。</span></li>
        <li><a href={ncStateSource(speciesId)} target="_blank" rel="noreferrer">NC State · {sp.latin} ↗</a><span>物种介绍与参考影像；2026-11-05 已核对形态介绍与图片署名；年龄曲线和材性并非来自该页面实测。</span></li>
        <li>{sp.campus ? <a href={sp.campus} target="_blank" rel="noreferrer">西湖大学校园来源 ↗</a> : <strong>校园分布待核实</strong>}<span>{sp.campus ? '校园报道仅支持存在记录，不能提供本组件照片的个体身份或材料实测值。' : '地区分布或栽培依据不能替代校园个体记录。'}</span></li>
      </ul>
      <p className="se-note">照片逐条署名见照片下方；年龄曲线和材料参数属于工程先验。尚无本组件可用的校园个体几何、材料试验或跨季节校准数据。</p>
    </details>
  </section>;
}
