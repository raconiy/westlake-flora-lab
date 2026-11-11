import {Activity,ArrowUpRight,CheckCircle2,Clock3,ExternalLink,RefreshCw,Send,ShieldCheck,TriangleAlert,UsersRound} from 'lucide-react';

type ProgressTrackerProps={
  tasks:any[];
  online:boolean;
  health:any;
  onRefresh:()=>void;
  onOpenSwarm:()=>void;
};

import {progressMeta,progressTasks,type ProgressTask} from './progressData';

const statusLabel=(state:ProgressTask['status'])=>state==='done'?'已发布':state==='active'?'当前迭代':state==='blocked'?'阻塞待处理':'待派发';
const statusIcon=(state:ProgressTask['status'])=>state==='done'?<CheckCircle2 size={15}/>:state==='active'?<Activity size={15}/>:state==='blocked'?<TriangleAlert size={15}/>:<Clock3 size={15}/>;

export default function ProgressTracker({tasks,online,health,onRefresh,onOpenSwarm}:ProgressTrackerProps){
  const running=tasks.filter((task)=>['running','processing','in_progress','claimed'].includes(String(task?.status||'').toLowerCase())).length;
  const queued=tasks.filter((task)=>['queued','pending','created'].includes(String(task?.status||'').toLowerCase())).length;
  const failed=tasks.filter((task)=>['failed','error','blocked'].includes(String(task?.status||'').toLowerCase())||task?.error||task?.failureReason).length;
  const accountCount=typeof health?.gateway?.availableAccounts==='number'?health.gateway.availableAccounts:5;
  return <section className="progress-workspace" aria-label="项目进度追踪">
    <div className="progress-hero">
      <div>
        <span className="eyebrow"><Activity size={13}/> PUBLIC PROJECT TRACKER / {progressMeta.version}</span>
        <h2>每一次 refine，都留下证据。</h2>
        <p>这里展示已经完成、正在迭代和等待现场校准的工作。公开页面只显示任务摘要、状态和证据链接，不显示密码、授权令牌或本地桥接凭据。</p>
      </div>
      <div className="progress-hero-actions">
        <span className={`progress-live ${online?'is-online':''}`}><span/>{online?'协调服务在线':'公网只读快照'}</span>
        <button className="subtle-button" onClick={onRefresh}><RefreshCw size={14}/>刷新状态</button>
      </div>
    </div>

    <div className="progress-kpis" aria-label="项目概览指标">
      <article><span>已发布版本</span><b>{progressMeta.version}</b><small>{progressMeta.release.slice(0,8)}</small></article>
      <article><span>五账号协作</span><b>{accountCount}</b><small>账号级记录 · 不等同 worker</small></article>
      <article><span>当前任务</span><b>{running+queued}</b><small>{running} 执行中 · {queued} 排队</small></article>
      <article className={failed?'is-warning':''}><span>需复核</span><b>{failed}</b><small>{failed?'保留失败原因，未伪称成功':'当前协调服务未报告失败'}</small></article>
    </div>

    <div className="progress-main-grid">
      <section className="progress-timeline" aria-labelledby="progress-timeline-title">
        <div className="progress-section-heading"><div><span className="eyebrow">DELIVERY ROADMAP</span><h3 id="progress-timeline-title">项目阶段</h3></div><span className="last-verified">最后更新 · {progressMeta.updatedAt.slice(0,16).replace('T',' ')}</span></div>
        <div className="progress-stage-list">
          {progressTasks.map((stage)=><article className={`progress-stage ${stage.status}`} key={stage.id}>
            <div className="progress-stage-marker">{statusIcon(stage.status)}</div>
            <div className="progress-stage-body">
              <div className="progress-stage-top"><div><h4>{stage.title}</h4><span>{statusLabel(stage.status)} · {stage.owner}</span></div><strong>{stage.progress}%</strong></div>
              <div className="progress-bar" aria-label={`${stage.title} ${stage.progress}%`}><span style={{width:`${stage.progress}%`}}/></div>
              <p>{stage.summary}</p>
              {stage.evidence?.map((e)=><a key={e.href} href={e.href} target="_blank" rel="noreferrer">{e.label} <ArrowUpRight size={13}/></a>)}
            </div>
          </article>)}
        </div>
      </section>

      <aside className="progress-sidebar">
        <section className="progress-card progress-next">
          <div className="progress-card-heading"><span className="eyebrow">NEXT REFINEMENT</span><span className="priority-pill">优先</span></div>
          <h3>把“看起来像”变成“可校准”。</h3>
          <p>下一轮建议先补现场个体数据，再调整树冠、草地密度和枝叶物理。这样能避免只靠静态图片继续放大误差。</p>
          <button className="primary-button" onClick={onOpenSwarm}><Send size={14}/>进入协作中枢派发</button>
        </section>
        <section className="progress-card progress-evidence">
          <div className="progress-card-heading"><span className="eyebrow">PUBLIC EVIDENCE</span><ShieldCheck size={16}/></div>
          <a href="https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/" target="_blank" rel="noreferrer"><span>照片对照页</span><ExternalLink size={13}/></a>
          <a href="https://raconiy.github.io/westlake-flora-lab/capture17/scene-r7/dispatch/" target="_blank" rel="noreferrer"><span>五账号派工记录</span><ExternalLink size={13}/></a>
          <a href="https://github.com/raconiy/westlake-flora-lab/releases/tag/yungu-capture17-v7" target="_blank" rel="noreferrer"><span>R7 工程包与 CI</span><ExternalLink size={13}/></a>
          <p>公开记录会区分已采用、被拒绝和未验证的结果。</p>
        </section>
        <section className="progress-card progress-policy">
          <div className="progress-card-heading"><span className="eyebrow">TEAM RULES</span><UsersRound size={16}/></div>
          <ul><li>每条建议先生成任务 ID，再进入派工队列。</li><li>每个账号的成功请求、输出 token 和失败原因单独记录。</li><li>只有测试、复核和发布回执通过后，状态才会变成“已发布”。</li></ul>
          <span className="progress-caution"><TriangleAlert size={14}/>公网页面是只读进度证据；提交建议请进入协作中枢。</span>
        </section>
      </aside>
    </div>
  </section>;
}
