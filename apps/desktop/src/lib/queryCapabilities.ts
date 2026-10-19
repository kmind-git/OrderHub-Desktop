/**
 * Explicit capability boundary for queries that the current `orderhub.v1`
 * proto does not provide. The UI must show "后台暂未提供该查询接口" and keep
 * real query/export actions disabled. Replacing an adapter later should not
 * require changing the page layout.
 */

export interface QueryCapability {
  id: string;
  title: string;
  requirement: string;
  current: string;
  plannedColumns: string[];
  filters: string[];
  image: string;
  imageWidth: number;
  note: string;
}

export const queryCapabilities = {
  historyOrders: {
    id: "history-orders",
    title: "历史订单",
    requirement: "按时间、合约、状态分页检索历史订单",
    current:
      "当前 proto 只提供 Snapshot（仅活动订单）与 OrderLookup（按已知订单 ID 查询活动或终态订单），没有可枚举全部历史订单的列表接口。",
    plannedColumns: ["下单时间", "合约", "方向", "数量", "价格", "累计成交", "状态", "订单 ID"],
    filters: ["时间范围", "合约", "方向", "状态"],
    image: "/assets/orderhub/query-placeholder.png",
    imageWidth: 220,
    note: "本页不会把“当前快照中没有”说成“历史查询结果为零”。",
  },
  trades: {
    id: "trades",
    title: "历史成交",
    requirement: "历史成交明细检索与导出",
    current:
      "当前没有独立的历史成交查询接口；WatchEvents 只包含本次会话收到的执行事实，不能冒充完整历史。",
    plannedColumns: ["成交时间", "订单 ID", "成交号", "合约", "方向", "数量", "价格", "费用"],
    filters: ["时间范围", "合约", "订单 ID"],
    image: "/assets/orderhub/query-placeholder.png",
    imageWidth: 220,
    note: "本次会话执行事实会在订单详情中单独标注，不作为历史成交清单。",
  },
  accountTotals: {
    id: "account-totals",
    title: "全账户资金与持仓",
    requirement: "全账户资金余额、可用资金与全账户持仓",
    current:
      "当前只有 Token 授权策略的账本投影：AccountView 是策略资金占用，PositionView 是策略内部持仓，不是账户全局资产，也不提供 buying power。",
    plannedColumns: ["账户", "币种", "余额", "可用", "占用", "全账户持仓"],
    filters: ["账户", "币种"],
    image: "/assets/orderhub/query-placeholder.png",
    imageWidth: 220,
    note: "工作台展示的是当前身份可见的授权策略视图，已明确标注，不标成账户全局资产。",
  },
  marketQuotes: {
    id: "market-quotes",
    title: "行情查询",
    requirement: "实时报价、盘口与行情图表",
    current:
      "当前服务未提供报价查询，Snapshot 也不返回 quotes。报单价格必须由用户精确输入，界面不会展示虚构实时行情。",
    plannedColumns: ["合约", "最新价", "买价", "卖价", "成交量", "时间"],
    filters: ["合约"],
    image: "/assets/orderhub/query-placeholder.png",
    imageWidth: 200,
    note: "没有行情接口时不展示占位数字；价格校验只使用 Snapshot 的合约步进与精度。",
  },
} satisfies Record<string, QueryCapability>;

export type QueryCapabilityId = keyof typeof queryCapabilities;

/** Adapter boundary reserved for a future list query. */
export async function unavailableQuery(_capability: QueryCapabilityId): Promise<never> {
  throw new Error("后台暂未提供该查询接口");
}
