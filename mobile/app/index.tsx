import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Mode = "research" | "strategies" | "live";
type Item = { id: string; name: string; description: string; detail: string; state: string };
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api";
const configs = {
  research: { label: "因子", title: "因子研究", placeholder: "表达式或研究说明" },
  strategies: { label: "策略", title: "策略管理", placeholder: "规则与风险约束" },
  live: { label: "运行定义", title: "实时运行", placeholder: "数据源、频率与标的范围" },
} as const;

export default function HomeScreen() {
  const [mode, setMode] = useState<Mode>("research");
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const config = useMemo(() => configs[mode], [mode]);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/workspaces/${mode}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      setItems(payload.items);
    } catch {
      setMessage("无法连接 v3 API，请检查 EXPO_PUBLIC_API_URL");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (name.trim().length < 2) {
      setMessage("名称至少需要两个字");
      return;
    }
    const response = await fetch(`${API}/workspaces/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, detail, description: "", tags: [] }),
    });
    if (!response.ok) {
      setMessage("保存失败");
      return;
    }
    setName("");
    setDetail("");
    setMessage(`${config.label}已保存`);
    await load();
  }

  async function toggle(item: Item) {
    const state = item.state === "enabled" ? "paused" : "enabled";
    await fetch(`${API}/workspaces/live/${item.id}/state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    await load();
  }

  useEffect(() => { void load(); }, [mode]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>NEXTLEEK V3 MOBILE</Text>
        <Text style={styles.title}>{config.title}</Text>
        <Text style={styles.body}>与 Web 共用同一套独立 API 和持久化工作区。</Text>
        <View style={styles.tabs}>
          {(Object.keys(configs) as Mode[]).map((key) => (
            <Pressable key={key} onPress={() => setMode(key)} style={[styles.tab, mode === key && styles.tabActive]}>
              <Text style={[styles.tabText, mode === key && styles.tabTextActive]}>{configs[key].title}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.editor}>
          <Text style={styles.cardTitle}>新建{config.label}</Text>
          <TextInput value={name} onChangeText={setName} placeholder={config.label + "名称"} placeholderTextColor="#647991" style={styles.input} />
          <TextInput value={detail} onChangeText={setDetail} placeholder={config.placeholder} placeholderTextColor="#647991" multiline style={[styles.input, styles.textarea]} />
          <Pressable onPress={create} style={styles.primary}><Text style={styles.primaryText}>保存{config.label}</Text></Pressable>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>
        <View style={styles.library}>
          <Text style={styles.cardTitle}>已保存 · {items.length}</Text>
          {loading ? <ActivityIndicator color="#55d6a7" /> : null}
          {!loading && items.length === 0 ? <Text style={styles.empty}>工作区为空，创建第一项开始。</Text> : null}
          {items.map((item) => (
            <View key={item.id} style={styles.record}>
              <View style={styles.recordTop}><Text style={styles.recordTitle}>{item.name}</Text><Text style={styles.state}>{item.state}</Text></View>
              {item.detail ? <Text style={styles.recordBody}>{item.detail}</Text> : null}
              {mode === "live" ? <Pressable onPress={() => toggle(item)} style={styles.secondary}><Text style={styles.secondaryText}>{item.state === "enabled" ? "暂停定义" : "启用定义"}</Text></Pressable> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111d" },
  content: { padding: 22, gap: 18 },
  eyebrow: { color: "#55d6a7", fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#f2f6fb", fontSize: 42, fontWeight: "800", letterSpacing: -1.5 },
  body: { color: "#91a6bc", fontSize: 16, lineHeight: 24 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tab: { borderWidth: 1, borderColor: "#29445f", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  tabActive: { backgroundColor: "#55d6a7", borderColor: "#55d6a7" },
  tabText: { color: "#a9bbcc", fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: "#06150f" },
  editor: { borderWidth: 1, borderColor: "#1d3650", borderRadius: 20, padding: 18, gap: 12, backgroundColor: "#0d1e30" },
  library: { gap: 12 },
  cardTitle: { color: "#f2f6fb", fontSize: 21, fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#29445f", backgroundColor: "#071521", borderRadius: 12, color: "#f2f6fb", padding: 13 },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  primary: { backgroundColor: "#55d6a7", borderRadius: 12, padding: 14, alignItems: "center" },
  primaryText: { color: "#06150f", fontWeight: "900" },
  message: { color: "#79dfb9", fontSize: 13 },
  empty: { color: "#8196ac", borderWidth: 1, borderColor: "#1d3650", borderRadius: 16, padding: 18 },
  record: { borderWidth: 1, borderColor: "#203c58", borderRadius: 16, padding: 17, gap: 10, backgroundColor: "#0a1928" },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  recordTitle: { color: "#f2f6fb", fontSize: 17, fontWeight: "800", flex: 1 },
  state: { color: "#55d6a7", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  recordBody: { color: "#a5b7c9", lineHeight: 21 },
  secondary: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#55d6a7", borderRadius: 9, paddingHorizontal: 13, paddingVertical: 8 },
  secondaryText: { color: "#55d6a7", fontWeight: "800" },
});
