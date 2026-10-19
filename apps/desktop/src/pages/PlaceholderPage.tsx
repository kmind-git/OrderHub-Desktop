import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  PageHeader,
  Panel,
} from "../components/ui";
import {
  queryCapabilities,
  type QueryCapabilityId,
} from "../lib/queryCapabilities";

export function PlaceholderPage({
  capabilityId,
  navigate,
}: {
  capabilityId: QueryCapabilityId;
  navigate: (path: string) => void;
}) {
  const capability = queryCapabilities[capabilityId];
  const { isDemo } = useApp();

  return (
    <div className="page">
      <PageHeader
        eyebrow="QUERY / RESERVED"
        title={capability.title}
        description="该页面保留入口、筛选条件与数据适配边界；当前 proto 未提供对应查询能力。"
        actions={
          <Badge tone="warn" dot>
            后台暂未提供该查询接口
          </Badge>
        }
      />

      <div className="placeholder-grid">
        <Panel className="placeholder-visual">
          <div className="placeholder-image-wrap">
            <img
              src={capability.image}
              alt=""
              width={1254}
              height={1254}
              style={{ width: capability.imageWidth }}
            />
          </div>
          <div className="placeholder-copy">
            <div className="placeholder-status">能力状态：UNAVAILABLE</div>
            <h2>后台暂未提供该查询接口</h2>
            <p>{capability.current}</p>
            <div className="button-row">
              {capabilityId === "accountTotals" ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => navigate("/workspace")}
                >
                  <Icon name="wallet" size={16} />
                  查看授权策略视图
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => navigate("/workspace")}
                >
                  <Icon name="workspace" size={16} />
                  查看当前已加载数据
                </button>
              )}
              <button type="button" className="button button-ghost" disabled>
                <Icon name="download" size={16} />
                导出（未启用）
              </button>
            </div>
            <p className="small muted">{capability.note}</p>
          </div>
        </Panel>

        <div className="placeholder-side">
          <Panel title="需求与当前能力">
            <div className="capability-block">
              <div className="small-label">查询需求</div>
              <div>{capability.requirement}</div>
            </div>
            <div className="capability-block">
              <div className="small-label">当前接口能力</div>
              <div>{capability.current}</div>
            </div>
            <div className="capability-block">
              <div className="small-label">计划字段（前端草案，以新增契约为准）</div>
              <div className="column-chips">
                {capability.plannedColumns.map((column) => (
                  <span className="chip" key={column}>
                    {column}
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="能力适配层">
            <div className="adapter-state">
              <span className="adapter-dot" aria-hidden="true" />
              <div>
                <div className="mono">queryCapabilities.{capabilityId}.available === false</div>
                <div className="small muted">
                  页面结构与筛选/分页位置已保留。后续接入新接口时只替换适配实现，不改变页面结构。
                </div>
              </div>
            </div>
            <div className="divider" />
            <ul className="plain-list small muted">
              <li>页面不会显示“查询成功、暂无数据”或导出的伪结果。</li>
              <li>查询与导出操作保持禁用，直到新增接口契约可用。</li>
              <li>筛选条件和分页字段仅作为前端草案。</li>
            </ul>
          </Panel>
        </div>
      </div>

      <Panel
        title="查询条件（草案）"
        subtitle="控件保持禁用；它们不对应现有服务端参数。"
        actions={<Badge tone="muted">disabled</Badge>}
      >
        <div className="draft-filters">
          {capability.filters.map((filter, index) => (
            <label className="field" key={filter}>
              <span className="field-label">{filter}</span>
              {index === 0 && capabilityId === "historyOrders" ? (
                <input type="date" disabled aria-label={`${filter}（未启用）`} />
              ) : index === 0 && capabilityId === "trades" ? (
                <input type="date" disabled aria-label={`${filter}（未启用）`} />
              ) : (
                <select disabled aria-label={`${filter}（未启用）`} defaultValue="">
                  <option value="">未启用</option>
                </select>
              )}
            </label>
          ))}
          <div className="field draft-actions">
            <span className="field-label">操作</span>
            <div className="button-row">
              <button type="button" className="button button-primary" disabled>
                查询（未启用）
              </button>
              <button type="button" className="button button-ghost" disabled>
                重置
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="结果区域"
        subtitle="没有接口时不渲染任何占位行，避免被误读为“查询结果为零”。"
      >
        <div className="table-scroll">
          <table className="data-table data-table-empty">
            <caption className="sr-only">{capability.title}计划结果字段</caption>
            <thead>
              <tr>
                {capability.plannedColumns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={capability.plannedColumns.length}>
                  <div className="table-unavailable">
                    <Icon name="lock" size={18} />
                    <div>
                      <strong>后台暂未提供该查询接口</strong>
                      <div className="small muted">
                        结果表格只展示计划字段，没有虚构数据，也没有实现导出。
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="pagination-draft" aria-disabled="true">
          <span className="small muted">分页适配位置</span>
          <button type="button" className="button button-ghost button-small" disabled>
            上一页
          </button>
          <span className="mono">— / —</span>
          <button type="button" className="button button-ghost button-small" disabled>
            下一页
          </button>
        </div>
      </Panel>

      {isDemo ? (
        <Callout tone="warn" title="开发演示数据" icon="info">
          本页只展示预留布局；即使使用演示后端，也不会伪造该查询的结果。
        </Callout>
      ) : null}
    </div>
  );
}
