import { Button, ConfigProvider, Radio, Segmented, Select, Tag } from 'antd';
import { ArrowDown, ArrowUpRight, Check, ChevronRight, Layers3, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../i18n/Language';
import { useAppearance } from '../theme/ThemeProvider';
import type { Accent, AppearanceMode } from '../theme/tokens';
import { BasicExamples } from './BasicExamples';
import { ScenarioExamples } from './ScenarioExamples';

const groups = [
  ['按钮与动作层级', 'Buttons & actions', '01', '主要 / 次要 / 危险', 'Primary / secondary / danger'],
  ['选择与切换', 'Selection & switching', '02', '开关 / 单选 / 分段 / 标签', 'Switch / radio / segmented / tabs'],
  ['工具栏与批量操作', 'Toolbars & selection', '03', '筛选 / 范围 / 批量', 'Filters / scope / batch actions'],
  ['表单与弹窗', 'Forms & dialogs', '04', '校验 / 草稿 / 焦点', 'Validation / drafts / focus'],
  ['流程与高风险动作', 'Workflow & sensitive actions', '05', '处理资格 / 理由 / 确认', 'Eligibility / reason / confirmation'],
  ['导入与附件状态', 'Imports & attachments', '06', '部分成功 / 重试 / 扫描', 'Partial results / retry / scanning'],
  ['数据状态与详情', 'Data states & details', '07', '空态 / 错误 / 历史', 'Empty / error / history'],
  ['分析与扫码输入', 'Analytics & scan input', '08', '口径 / 缺失 / 连续输入', 'Definitions / missing data / input'],
] as const;

const domains = [
  ['D01', '身份与个人账号', 'Identity & account', '01 / 02 / 04 / 05 / 07', false],
  ['D02', '组织、岗位与权限', 'Organization & permissions', '01 / 02 / 03 / 04 / 05 / 07', false],
  ['D03', '外壳与双门户', 'Shell & portals', '01 / 02 / 03 / 04 / 07', false],
  ['D04', '主数据与关联选择', 'Master data & references', '01 / 02 / 03 / 04 / 06 / 07', false],
  ['D05', '问题与改进闭环', 'Problems & improvements', '01 / 02 / 03 / 04 / 05 / 07', false],
  ['D06', '受控流程与版本', 'Controlled workflows', '01 / 02 / 04 / 05 / 07', false],
  ['D07', '供应商问题、IQC、特采', 'Supplier issues, IQC & concessions', '01 / 03 / 04 / 05 / 06 / 07', false],
  ['D08', 'PPAP、SIP、PCN', 'PPAP, SIP & PCN', '01 / 02 / 04 / 05 / 06 / 07', false],
  ['D09', 'ASN、条码与现场', 'ASN, barcodes & site operations', '03 / 04 / 05 / 06 / 08', false],
  ['D10', '制程质量', 'Process quality', '01 / 03 / 04 / 05 / 06 / 08', false],
  ['D11', '客户质量', 'Customer quality', '01 / 03 / 04 / 05 / 06 / 07', false],
  ['D12', '新品、试产与移交', 'New products, trials & handover', '01 / 03 / 04 / 05 / 06 / 08', false],
  ['D13', '审核与现场执行', 'Audits & field execution', '01 / 02 / 04 / 05 / 06 / 08', false],
  ['D14', '文件、知识与公告', 'Documents, knowledge & announcements', '01 / 02 / 04 / 05 / 06 / 07', false],
  ['D15', '质量数据与风险分析', 'Quality data & risk analysis', '02 / 03 / 06 / 07 / 08', false],
  ['D16', '三坐标检测申请与排程', 'Inspection requests & scheduling', '01 / 03 / 04 / 05 / 07', false],
  ['D17', '治理、审计与运维', 'Governance, audit & operations', '01 / 03 / 04 / 05 / 06 / 07', false],
  ['D18', '外部系统与辅助分析', 'External systems & assisted analysis', '04 / 05 / 06 / 07 / 08', true],
  ['D19', '供应商准入与绩效', 'Supplier admission & performance', '01 / 03 / 04 / 05 / 06 / 07', false],
  ['D20', '索赔、计量、成本等扩展', 'Claims, metrology, cost & extensions', '03 / 04 / 05 / 06 / 07 / 08', true],
] as const;

export function InteractionPreview() {
  const { locale, setLocale } = useLanguage();
  const { preferences, setPreferences } = useAppearance();
  const english = locale === 'en-US';
  const text = (zh: string, en: string) => english ? en : zh;
  const [phone, setPhone] = useState(false);
  const [active, setActive] = useState('01');

  return <ConfigProvider theme={{ components: {
    Segmented: { trackPadding: 3 },
  } }}>
    <div className="interaction-preview">
      <a className="preview-skip" href="#preview-content">{text('跳到样例内容', 'Skip to examples')}</a>
      <header className="preview-header">
        <a href="#sample-01" className="preview-brand" aria-label={text('QMS 样例首页', 'QMS preview home')}>
          <span className="preview-brand-mark"><Layers3 size={23} aria-hidden="true" /></span>
          <span>QMS <span className="preview-brand-sub">DESIGN / 02</span></span>
        </a>
        <div className="preview-header-end"><span className="preview-candidate"><span />{text('视觉确认候选', 'Visual review candidate')}</span><span className="preview-local">{text('本地独立样例', 'Local preview')}</span></div>
      </header>

      <aside className="preview-sidebar" aria-label={text('样例导航', 'Example navigation')}>
        <div className="preview-sidebar-label">{text('基础交互', 'FOUNDATIONS')}</div>
        <nav aria-label={text('样例目录', 'Example directory')}>
          {groups.map(([zh, en, number, hintZh, hintEn]) => <a key={number} href={`#sample-${number}`} onClick={() => setActive(number)} className={active === number ? 'is-active' : ''}>
            <span className="preview-nav-number">{number}</span><span><strong>{english ? en : zh}</strong><small>{english ? hintEn : hintZh}</small></span><ChevronRight size={13} aria-hidden="true" />
          </a>)}
          <a href="#coverage" onClick={() => setActive('coverage')} className={active === 'coverage' ? 'is-active' : ''}><span className="preview-nav-number">D</span><span><strong>{text('领域适用矩阵', 'Domain coverage')}</strong><small>{text('当前与未来 20 组场景', '20 current & future domain groups')}</small></span><ChevronRight size={13} aria-hidden="true" /></a>
        </nav>
        <div className="preview-sidebar-foot"><span>REVIEW / 01</span><p>{text('先确认细节，再推广到正式页面。', 'Review the details before migrating business pages.')}</p><small>React 19 · Ant Design · Vite</small></div>
      </aside>

      <main id="preview-content" className="preview-main">
        <div className="preview-intro">
          <div className="preview-eyebrow">QMS INTERACTION LIBRARY <span>/ 2026.10</span></div>
          <h1>{text('把每一次操作，做清楚。', 'Make every action clear.')}</h1>
          <p>{text('按钮该突出什么、切换意味着什么、失败后怎么继续。在这里实际操作，再确认我们共同使用的交互基准。', 'Which action leads, what a switch means, and how to recover from failure. Try the controls before agreeing on a shared baseline.')}</p>
          <div className="preview-intro-bottom"><div><span><strong>08</strong>{text('交互样例组', 'example groups')}</span><span><strong>20</strong>{text('领域场景映射', 'domain mappings')}</span><span><strong>06</strong>{text('主题组合', 'theme combinations')}</span></div><a href="#sample-01">{text('从按钮开始', 'Start with buttons')}<ArrowDown size={14} aria-hidden="true" /></a></div>
        </div>

        <div className="preview-controls" aria-label={text('预览设置', 'Preview settings')}>
          <div><label htmlFor="preview-mode">{text('显示模式', 'Appearance')}</label><Select id="preview-mode" aria-label={text('显示模式', 'Appearance')} value={preferences.mode} prefix={<Monitor size={15} aria-hidden="true" />} onChange={(mode: AppearanceMode) => setPreferences({ ...preferences, mode })} options={[
            { value: 'light', label: text('浅色', 'Light') },
            { value: 'dark', label: text('深色', 'Dark') },
            { value: 'system', label: text('跟随系统', 'System') },
          ]} /></div>
          <div><span className="preview-control-label">{text('品牌主色', 'Accent')}</span><Radio.Group aria-label={text('品牌主色', 'Accent')} value={preferences.accent} onChange={(event) => setPreferences({ ...preferences, accent: event.target.value as Accent })} className="preview-accents">
            {(['blue', 'teal', 'purple'] as const).map((accent, index) => <Radio.Button key={accent} value={accent} aria-label={text(['晴空蓝', '湖水青', '鸢尾紫'][index]!, ['Blue', 'Teal', 'Purple'][index]!)}><span className={`preview-accent-dot is-${accent}`}>{preferences.accent === accent ? <Check size={12} aria-hidden="true" /> : null}</span></Radio.Button>)}
          </Radio.Group></div>
          <div><span className="preview-control-label">{text('界面语言', 'Language')}</span><Segmented aria-label={text('界面语言', 'Language')} options={[{ label: '中文', value: 'zh-CN' }, { label: 'EN', value: 'en-US' }]} value={locale} onChange={(value) => setLocale(value as 'zh-CN' | 'en-US')} /></div>
          <Button className="preview-device" icon={phone ? <Monitor size={16} aria-hidden="true" /> : <Smartphone size={16} aria-hidden="true" />} aria-pressed={phone} onClick={() => setPhone(!phone)}>{phone ? text('恢复宽屏', 'Full width') : text('390px 内容预览', '390px content preview')}</Button>
        </div>

        <div className="preview-boundary" role="note"><span className="preview-boundary-mark">i</span><p>{text('所有记录和结果均为本地演示；不会发单、审批或写入业务系统。下方展示的是候选规则，尚待视觉确认。', 'All records and results are local examples. No business requests, approvals or writes occur. These candidate rules await visual review.')}</p></div>

        <div className={`preview-stage${phone ? ' is-phone' : ''}`}>
          {phone ? <div className="preview-phone-label">390 PX / {text('内容响应式预览，实际设备另行验收', 'Content preview; real devices need separate validation')}</div> : null}
          <BasicExamples english={english} />
          <ScenarioExamples english={english} />
        </div>

        <section className="preview-coverage" id="coverage" aria-label={text('领域适用矩阵', 'Domain coverage')}>
          <div className="preview-section-heading"><span className="preview-section-number">D</span><div><h2>{text('同一套规则，覆盖不同业务。', 'Shared rules, different business contexts.')}</h2><p>{text('下面是交互模式的适用关系，不是功能上线清单。当前切片、占位、规划和真实验收仍以领域记录为准。', 'This maps interaction patterns, not released capabilities. Domain records remain the source for implemented slices, placeholders, plans and acceptance.')}</p></div></div>
          <div className="preview-domain-grid">{domains.map(([id, zh, en, samples, future]) => <article key={id}><div><span>{id}</span>{future ? <Tag variant="filled">{text('规划 / 扩展', 'Planned / extension')}</Tag> : null}</div><h3>{english ? en : zh}</h3><p>{text('适用样例', 'Examples')} <span>{samples}</span></p></article>)}</div>
          <p className="preview-note">{text('文件、风险等占位入口不代表业务已完成；外部同步、相机识别、全系统离线、SPC / MSA 与计量管理不因样例展示而启用。', 'Document and risk placeholders are not complete modules. These examples do not enable external sync, camera scanning, system-wide offline operation, SPC / MSA or metrology management.')}</p>
        </section>

        <footer className="preview-footer"><span>{text('审阅顺序：选型 → 层级 → 状态 → 细节 → 场景', 'Review: semantics → hierarchy → states → details → context')}</span><a href="#preview-content">{text('返回顶部', 'Back to top')}<ArrowUpRight size={14} aria-hidden="true" /></a></footer>
      </main>
    </div>
  </ConfigProvider>;
}
