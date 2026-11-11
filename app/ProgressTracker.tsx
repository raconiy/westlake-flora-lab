import {Activity,ArrowUpRight,CheckCircle2,Clock3,ExternalLink,RefreshCw,Send,ShieldCheck,TriangleAlert,UsersRound} from 'lucide-react';

type ProgressTrackerProps={
  tasks:any[];
  online:boolean;
  health:any;
  onRefresh:()=>void;
  onOpenSwarm:()=>void;
};

import {progressMeta,progressTasks,type ProgressTask} from './progressData';

const statusLabel=(state:ProgressTask['status'],hasBlocker=false)=>state==='done'?(hasBlocker?'已交付 · 有限制':'已发布'):state==='active'?'当前迭代':state==='blocked'?'阻塞待处理':'待派发';
const statusIcon=(state:ProgressTask['status'])=>state==='done'?<CheckCircle2 size={15}/>:state==='active'?<Activity size={15}/>:state==='blocked'?<TriangleAlert size={15}/>:<Clock3 size={15}/>;
const liveStatus=(task:any)=>String(task?.status||'').toLowerCase();
const liveStatusLabel=(status:string)=>['running','processing','in_progress','claimed'].includes(status)?'执行中':['queued','pending','created'].includes(status)?'排队中':['failed','error','blocked'].includes(status)?'需复核':['completed','done','validated','merged'].includes(status)?'已完成':status||'未报告';

export default function ProgressTracker({tasks,online,health,onRefresh,onOpenSwarm}:ProgressTrackerProps){
  const running=tasks.filter((task)=>['running','processing','in_progress','claimed'].includes(String(task?.status||'').toLowerCase())).length;
  const queued=tasks.filter((task)=>['queued','pending','created'].includes(String(task?.status||'').toLowerCase())).length;
  const failed=tasks.filter((task)=>['failed','error','blocked'].includes(String(task?.status||'').toLowerCase())||task?.error||task?.failureReason).length;
  const publishedStages=progressTasks.filter((stage)=>stage.status==='done').length;
  const staticBlockers=progressTasks.filter((stage)=>Boolean(stage.blocker)).length;
  const reviewCount=failed+staticBlockers;
  const overallProgress=Math.round(progressTasks.reduce((sum,stage)=>sum+Math.max(0,Math.min(100,stage.progress)),0)/progressTasks.length);
  const liveTasks=tasks.filter((task)=>task&&typeof task==='object'&& (task.title||task.id));
  const accountCount=typeof health?.gateway?.availableAccounts==='number'?health.gateway.availableAccounts:5;
  return <section className="progress-workspace" aria-label="项目进度追踪">
    <div className="progress-hero">
      <div>
        <span className="eyebrow"><Activity size={13}/> PUBLIC PROJECT TRACKER / {progressMeta.version}</span>
        <h2>修复进度与验证记录</h2>
        <p>这里展示已经完成、正在迭代和等待现场校准的工作。公开页面只显示任务摘要、状态和证据链接，不显示密码、授权令牌或本地桥接凭据。</p>
      </div>
      <div className="progress-hero-actions">
        <span className={`progress-live ${online?'is-online':''}`}><span/>{online?'协调服务在线':'公网只读快照'}</span>
        <button className="subtle-button" onClick={onRefresh}><RefreshCw size={14}/>刷新状态</button>
      </div>
    </div>

    <section className="progress-overall" aria-label="交付总进度">
      <div className="progress-overall-top"><div><span className="eyebrow">DELIVERY HEALTH</span><h3>当前交付进度</h3></div><strong>{overallProgress}%</strong></div>
      <div className="progress-overall-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallProgress} aria-label={`当前交付进度 ${overallProgress}%`}><span style={{width:`${overallProgress}%`}}/></div>
      <p>{publishedStages}/{progressTasks.length} 个阶段已记录；{staticBlockers} 个台账阻塞项，{online?`${liveTasks.length} 条实时任务已读取`:'实时队列未连接，使用已发布快照'}。阶段完成不等于照片级真实。</p>
    </section>

    <div className="progress-kpis" aria-label="项目概览指标">
      <article><span>已发布版本</span><b>{progressMeta.version}</b><small>{progressMeta.release.slice(0,8)}</small></article>
      <article><span>已核验账号</span><b>{accountCount}</b><small>{online?'协调服务回报':'发布证据记录'} · 不等同 worker</small></article>
      <article><span>当前任务</span><b>{running+queued}</b><small>{running} 执行中 · {queued} 排队</small></article>
      <article className={reviewCount?'is-warning':''}><span>需复核</span><b>{reviewCount}</b><small>{reviewCount?'包含公开台账阻塞与实时失败项':'当前没有已记录阻塞'}</small></article>
    </div>

    <div className="progress-main-grid">
      <section className="progress-timeline" aria-labelledby="progress-timeline-title">
        <div className="progress-section-heading"><div><span className="eyebrow">DELIVERY ROADMAP</span><h3 id="progress-timeline-title">项目阶段</h3></div><span className="last-verified">最后更新 · {progressMeta.updatedAt.slice(0,16).replace('T',' ')}</span></div>
        <div className="progress-stage-list">
          {progressTasks.map((stage)=><article className={`progress-stage ${stage.status}`} key={stage.id}>
            <div className="progress-stage-marker">{statusIcon(stage.status)}</div>
            <div className="progress-stage-body">
              <div className="progress-stage-top"><div><span className="progress-phase">{stage.phase}</span><h4>{stage.title}</h4><span>{statusLabel(stage.status,Boolean(stage.blocker))} · {stage.owner} · {stage.updatedAt}</span></div><strong>{stage.progress}%</strong></div>
              <div className="progress-bar" aria-label={`${stage.title} ${stage.progress}%`}><span style={{width:`${stage.progress}%`}}/></div>
              <p>{stage.summary}</p>
              {stage.metrics?.length ? <div className="progress-metrics">{stage.metrics.map(metric=><span key={metric.label}><b>{metric.value}</b>{metric.label}</span>)}</div> : null}
              {stage.blocker && <div className="progress-blocker"><TriangleAlert size={13}/><span>{stage.blocker}</span></div>}
              {stage.evidence?.map((e)=><a key={e.href} href={e.href} target="_blank" rel="noreferrer">{e.label} <ArrowUpRight size={13}/></a>)}
            </div>
          </article>)}
        </div>
      </section>

      <aside className="progress-sidebar">
        <section className="progress-card progress-next">
          <div className="progress-card-heading"><span className="eyebrow">NEXT REFINEMENT</span><span className="priority-pill">优先</span></div>
          <h3>待解决：冠形、覆盖与接地</h3>
          <p>下一轮建议先补现场个体数据，再调整树冠、草地密度和枝叶物理。这样能避免只靠静态图片继续放大误差。</p>
          <button className="primary-button" onClick={onOpenSwarm}><Send size={14}/>进入协作中枢派发</button>
        </section>
        <section className="progress-card progress-evidence">
          <div className="progress-card-heading"><span className="eyebrow">PUBLIC EVIDENCE</span><ShieldCheck size={16}/></div>
          <a href="https://raconiy.github.io/westlake-flora-lab/capture17/refine-20261111/" target="_blank" rel="noreferrer"><span>R7.1 修复与本轮调用记录</span><ExternalLink size={13}/></a>
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
        <section className="progress-card progress-live-queue">
          <div className="progress-card-heading"><span className="eyebrow">LIVE QUEUE</span><Clock3 size={16}/></div>
          {liveTasks.length ? <ul>{liveTasks.slice(0,6).map((task:any)=><li key={String(task.id||task.title)}><span><i className={`queue-dot ${liveStatus(task)}`}/>{task.title||task.id}</span><b>{liveStatusLabel(liveStatus(task))}</b></li>)}</ul> : <p>{online?'当前队列没有可公开任务。':'协调服务未连接；这里保留发布台账，不把静态记录伪装成实时执行。'}</p>}
        </section>
      </aside>
    </div>
  </section>;
}
