import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Op = { sig: string; desc: string };

const TS_OPS: Op[] = [
  { sig: "ts_mean(x, n)", desc: "近 n 日均值。n 整数，2–512。" },
  { sig: "ts_std(x, n)", desc: "近 n 日标准差。n 整数，2–512。" },
  { sig: "ts_sum(x, n)", desc: "近 n 日求和。n 整数，2–512。" },
  { sig: "ts_max(x, n)", desc: "近 n 日最高。n 整数，2–512。" },
  { sig: "ts_min(x, n)", desc: "近 n 日最低。n 整数，2–512。" },
  { sig: "ts_delay(x, n)", desc: "n 日前的值。n 整数，1–512，禁止负数。" },
  { sig: "ts_delta(x, n)", desc: "x − ts_delay(x, n)。n 整数，0–512，禁止负数。" },
  { sig: "ts_rank(x, n)", desc: "近 n 日滚动排名。n 整数，2–512。" },
  { sig: "ts_zscore(x, n)", desc: "(x − 均值) / 标准差，窗口 n。n 整数，2–512。" },
  { sig: "ts_corr(x, y, n)", desc: "x 与 y 近 n 日滚动相关。n 整数，2–512。" },
  { sig: "ts_cov(x, y, n)", desc: "x 与 y 近 n 日滚动协方差。n 整数，2–512。" },
  { sig: "ts_quantile(x, n, q)", desc: "近 n 日分位数。n 整数 2–512；q 数字常量，开区间 (0, 1)。" },
  { sig: "decay_linear(x, n)", desc: "近端权重大的线性衰减加权均值，权重 n…1。n 整数，2–512。" },
];

const CROSS_OPS: Op[] = [
  { sig: "rank(x)", desc: "当日截面百分位排名，约 (0, 1]。" },
  { sig: "zscore(x)", desc: "当日截面标准化 (x − 均值) / 标准差。" },
  { sig: "winsorize(x)", desc: "按当日截面均值 ± 3σ 截尾。k 可省略，默认 3。" },
  { sig: "winsorize(x, k)", desc: "按当日截面均值 ± kσ 截尾。k 数字常量，范围 [1, 6]。" },
];

const MATH_OPS: Op[] = [
  { sig: "if_else(cond, a, b)", desc: "cond 为真取 a，否则取 b。" },
  { sig: "min(a, b)", desc: "逐元素取较小值。" },
  { sig: "max(a, b)", desc: "逐元素取较大值。" },
  { sig: "log(x)", desc: "自然对数。x ≤ 0 为缺失。" },
  { sig: "abs(x)", desc: "绝对值。" },
  { sig: "sign(x)", desc: "符号：正 1、负 −1、零 0。" },
  { sig: "sqrt(x)", desc: "平方根。x < 0 为缺失。" },
  { sig: "power(x, c)", desc: "x 的 c 次方。c 数字常量，|c| ≤ 4。" },
  { sig: "clamp(x, lo, hi)", desc: "截断到 [lo, hi]。lo、hi 数字常量，且 lo ≤ hi。" },
];

function DocCard({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`doc-card${open ? " is-open" : ""}`}>
      <button type="button" className="doc-card-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={14} className="doc-card-chevron" />
      </button>
      {open ? <div className="doc-card-body">{children}</div> : null}
    </section>
  );
}

function OpList({ items }: { items: Op[] }) {
  return (
    <div className="doc-ops">
      {items.map((item) => (
        <div key={item.sig} className="doc-op">
          <code>{item.sig}</code>
          <span>{item.desc}</span>
        </div>
      ))}
    </div>
  );
}

export function FormulaDocs() {
  return (
    <div className="doc-cards">
      <DocCard title="DSL 公式" defaultOpen>
        <p>策略必须是布尔表达式，因子必须是数值表达式。窗口和常量参数必须是数字字面量。</p>
        <pre className="doc-example">{`close > ts_mean(close, 120) and volume > ts_mean(volume, 20)
ts_mean(close, 120)
close / ts_mean(close, 120) - 1`}</pre>
        <h4>语法</h4>
        <ul>
          <li>算术：+ − * /（除零为缺失）</li>
          <li>比较：&gt; &gt;= &lt; &lt;= == !=</li>
          <li>逻辑：and or（没有 not）</li>
          <li>一元负号：-x</li>
          <li>注释：# 或 // 直到行尾</li>
          <li>涨跌幅用小数，5% 写成 0.05</li>
        </ul>
        <h4>限制</h4>
        <ul>
          <li>最多 200 个记号，AST 深度 ≤ 12</li>
          <li>时序窗口 n：2–512（ts_delay 为 1–512，ts_delta 为 0–512）</li>
          <li>已保存的自定义因子 id 也可当列名引用</li>
        </ul>
        <h4>时序算子</h4>
        <OpList items={TS_OPS} />
        <h4>截面算子</h4>
        <OpList items={CROSS_OPS} />
        <h4>数学算子</h4>
        <OpList items={MATH_OPS} />
        <h4>可用列</h4>
        <div className="doc-cols">
          <strong>基准列</strong>
          <p>open 开盘；high 最高；low 最低；close 收盘；volume 成交量；amount 成交额；turnover_rate 换手率；prev_close 前收；raw_close 未复权收盘</p>
        </div>
        <div className="doc-cols">
          <strong>基础指标</strong>
          <p>change_pct 涨跌幅(小数)；change_amount 涨跌额；amplitude 振幅；consecutive_limit_ups 连板；consecutive_limit_downs 连跌</p>
        </div>
        <div className="doc-cols">
          <strong>均线</strong>
          <p>ma5 ma10 ma20 ma30 ma60；ema5 ema10 ema20 ema30 ema60</p>
        </div>
        <div className="doc-cols">
          <strong>技术指标</strong>
          <p>macd_dif macd_dea macd_hist；boll_upper boll_lower；kdj_k kdj_d kdj_j；atr_14；rsi_6 rsi_14 rsi_24</p>
        </div>
        <div className="doc-cols">
          <strong>量价 / 动量</strong>
          <p>vol_ma5 vol_ma10 vol_ratio_5d；high_60d low_60d；momentum_5d/10d/20d/30d/60d；deviate_3d/10d/30d；annual_vol_20d</p>
        </div>
        <div className="doc-cols">
          <strong>信号列 (布尔)</strong>
          <p>signal_ma_golden_5_20 / signal_ma_dead_5_20；signal_ma_golden_20_60；signal_macd_golden / signal_macd_dead；signal_ma5/10/20_breakout / _breakdown；signal_n_day_high / signal_n_day_low；signal_boll_breakout_upper / _breakdown_lower；signal_volume_surge；signal_limit_up / signal_limit_down；signal_limit_down_recovery；signal_broken_limit_up</p>
        </div>
      </DocCard>
      <DocCard title="AI Skill" defaultOpen>
        <p>角色：A 股量化公式助手。只产出 NextLeek DSL，不写 Python。</p>
        <h4>输入</h4>
        <ul>
          <li>用中文描述选股、因子或条件逻辑</li>
          <li>点发送；未配置 AI 时去设置页填写接口</li>
          <li>推理可能要几十秒，对话显示「生成中」</li>
        </ul>
        <h4>意图</h4>
        <ul>
          <li>strategy：需要均线、量能、窗口算子的布尔公式</li>
          <li>factor：数值因子或指标</li>
          <li>condition：涨跌幅、价格、成交额等简单字段比较</li>
          <li>chat：闲聊或无法量化时只回答，不给公式</li>
        </ul>
        <h4>好的描述</h4>
        <ul>
          <li>收盘站上 120 日均线，并且成交量大于 20 日均量</li>
          <li>20 日涨幅超过 10%，但不要用涨停板计数</li>
          <li>换手率大于 5%，收盘价大于 10 元</li>
        </ul>
        <h4>落到 IDE</h4>
        <p>点「新建策略 / 因子 / 条件」写入左侧编辑器。策略和因子会带中文注释与 DSL 版本头，再校验、保存后才能运行、发布、回测。</p>
      </DocCard>
    </div>
  );
}
