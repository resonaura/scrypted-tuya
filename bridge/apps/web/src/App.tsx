import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, ListBox, Select, Skeleton, Surface, TextField } from "@heroui/react";
import { Navbar } from "./components/Navbar.js";
import { StatsBanner } from "./components/StatsBanner.js";
import { CameraCard } from "./components/CameraCard.js";
import { AddCameraModal } from "./components/AddCameraModal.js";
import { VideoPlayerModal } from "./components/VideoPlayerModal.js";
import { deleteCamera, fetchAuthState, fetchCameras, getWsUrl, logout, refreshCameras, updateCamera } from "./api/client.js";
import type { AuthState, Camera } from "./types/index.js";
import { Toaster, toast } from "sonner";
import { AlertCircle, Camera as CameraIcon, Plus, WifiOff } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const ORDER_KEY = "tuya-bridge.camera-order.v1";
type CameraFilter = "all" | "online" | "offline";
type CameraSort = "custom" | "name" | "status";

export function App() {
  const reduceMotion = useReducedMotion();
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("tuya-bridge.theme") === "light" ? "light" : "dark");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraOrder, setCameraOrder] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); } catch { return []; } });
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CameraFilter>("all");
  const [sort, setSort] = useState<CameraSort>("custom");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tuya-bridge.theme", theme);
  }, [theme]);
  useEffect(() => localStorage.setItem(ORDER_KEY, JSON.stringify(cameraOrder)), [cameraOrder]);

  const loadAuth = useCallback(async () => { try { setAuthState(await fetchAuthState()); } catch { setAuthState(null); } }, []);
  const loadCameras = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const list = await fetchCameras();
      setCameras(list);
      setCameraOrder((current) => [...current.filter((id) => list.some((camera) => camera.id === id)), ...list.map((camera) => camera.id).filter((id) => !current.includes(id))]);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || "The bridge did not respond");
      if (!quiet) toast.error("Failed to load cameras");
    } finally { setIsLoading(false); setIsRefreshing(false); }
  }, []);

  useEffect(() => {
    void loadAuth(); void loadCameras();
    let disposed = false; let ws: WebSocket | null = null; let retry: number | undefined;
    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => !disposed && setIsWsConnected(true);
        ws.onmessage = (event) => { try { const data = JSON.parse(event.data); if (["session_started", "p2p_connected", "webrtc_connected", "webrtc_disconnected", "unhealthy"].includes(data.event)) void loadCameras(true); } catch {} };
        ws.onerror = () => !disposed && setIsWsConnected(false);
        ws.onclose = () => { if (!disposed) { setIsWsConnected(false); retry = window.setTimeout(connect, 3000); } };
      } catch { retry = window.setTimeout(connect, 3000); }
    };
    connect();
    const poll = window.setInterval(() => void loadCameras(true), 20_000);
    return () => { disposed = true; if (retry) window.clearTimeout(retry); window.clearInterval(poll); ws?.close(); };
  }, [loadAuth, loadCameras]);

  useEffect(() => { if (selectedCamera) { const fresh = cameras.find((camera) => camera.id === selectedCamera.id); if (fresh) setSelectedCamera(fresh); } }, [cameras, selectedCamera?.id]);

  const displayedCameras = useMemo(() => {
    const orderIndex = new Map(cameraOrder.map((id, index) => [id, index]));
    const normalized = query.trim().toLowerCase();
    const result = cameras.filter((camera) => (filter === "all" || (filter === "online") === camera.online) && (!normalized || camera.name.toLowerCase().includes(normalized) || camera.did.toLowerCase().includes(normalized)));
    result.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "status" ? Number(b.online) - Number(a.online) || a.name.localeCompare(b.name) : (orderIndex.get(a.id) ?? 1e9) - (orderIndex.get(b.id) ?? 1e9));
    return result;
  }, [cameraOrder, cameras, filter, query, sort]);

  const moveCamera = (id: string, direction: -1 | 1) => {
    const visibleIndex = displayedCameras.findIndex((camera) => camera.id === id);
    const swapWith = displayedCameras[visibleIndex + direction]?.id;
    if (!swapWith) return;
    setSort("custom");
    setCameraOrder((current) => {
      const visibleIds = displayedCameras.map((camera) => camera.id);
      const base = sort === "custom" ? current : [...visibleIds, ...current.filter((cameraId) => !visibleIds.includes(cameraId))];
      const source = base.indexOf(id);
      const target = base.indexOf(swapWith);
      if (source < 0 || target < 0) return current;
      const next = [...base];
      [next[source], next[target]] = [next[target], next[source]];
      return next;
    });
  };

  const handleSync = async () => {
    if (!authState?.loggedIn) { setIsAddModalOpen(true); toast.info("Connect a Tuya account to discover cloud cameras"); return; }
    setIsRefreshing(true);
    try { const response = await refreshCameras(); setCameras(response.cameras || []); await loadAuth(); toast.success(`Synced ${response.cameras?.length || 0} camera(s)`); }
    catch (error: any) { toast.error(error?.message || "Tuya sync failed"); }
    finally { setIsRefreshing(false); }
  };
  const handleLogout = async () => {
    try {
      await logout();
      setCameras([]);
      setAuthState(null);
      await Promise.all([loadAuth(), loadCameras(true)]);
      toast.info("Account signed out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };
  const onlineCount = cameras.filter((camera) => camera.online).length;

  return <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
    <Toaster theme={theme} position="top-right" richColors />
    <Navbar onlineCount={onlineCount} totalCount={cameras.length} isWsConnected={isWsConnected} authState={authState} onAddClick={() => setIsAddModalOpen(true)} onRefreshClick={handleSync} onLogoutClick={handleLogout} isRefreshing={isRefreshing} theme={theme} onToggleTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")} />
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <motion.section initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Camera workspace</p><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Streams at a glance</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Fast RTSP access, browser WebRTC playback, and continuously refreshed snapshots.</p></div><Button variant="primary" onPress={() => setIsAddModalOpen(true)}><Plus className="size-4" /> Add profile</Button></div>
        <StatsBanner totalCameras={cameras.length} onlineCameras={onlineCount} isBridgeConnected={isWsConnected} />
      </motion.section>
      <Surface className="mb-5 grid gap-3 rounded-2xl border border-default-200/70 bg-content1/70 p-3 md:grid-cols-[minmax(240px,1fr)_180px_180px]">
        <TextField value={query} onChange={setQuery} aria-label="Search cameras"><Input placeholder="Search by camera name or DID" variant="secondary" /></TextField>
        <Select selectedKey={filter} onSelectionChange={(key) => setFilter((key as CameraFilter) || "all")} aria-label="Filter cameras"><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="all">All cameras</ListBox.Item><ListBox.Item id="online">Online only</ListBox.Item><ListBox.Item id="offline">Offline only</ListBox.Item></ListBox></Select.Popover></Select>
        <Select selectedKey={sort} onSelectionChange={(key) => setSort((key as CameraSort) || "custom")} aria-label="Sort cameras"><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="custom">Custom order</ListBox.Item><ListBox.Item id="name">Name</ListBox.Item><ListBox.Item id="status">Online first</ListBox.Item></ListBox></Select.Popover></Select>
      </Surface>
      {loadError && <Surface className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger/10 p-4"><div className="flex items-center gap-3"><AlertCircle className="size-5 text-danger" /><div><p className="text-sm font-semibold">Bridge connection failed</p><p className="text-xs text-muted-foreground">{loadError}</p></div></div><Button size="sm" variant="secondary" onPress={() => void loadCameras()}>Retry</Button></Surface>}
      {isLoading ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[0,1,2].map((item) => <Skeleton key={item} className="aspect-[4/3] rounded-3xl" />)}</div>
      : cameras.length === 0 ? <Surface className="rounded-3xl border border-dashed border-default-300 p-12 text-center"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><CameraIcon className="size-7" /></div><h3 className="text-lg font-semibold">No cameras yet</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Connect Smart Life or Tuya Smart with QR, or add a camera manually.</p><Button className="mt-5" variant="primary" onPress={() => setIsAddModalOpen(true)}><Plus className="size-4" /> Add profile</Button></Surface>
      : displayedCameras.length === 0 ? <Surface className="rounded-3xl p-10 text-center"><WifiOff className="mx-auto mb-3 size-7 text-muted-foreground" /><h3 className="font-semibold">No matching cameras</h3><p className="text-sm text-muted-foreground">Change the search or status filter.</p><Button className="mt-4" size="sm" variant="secondary" onPress={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button></Surface>
      : <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"><AnimatePresence mode="popLayout">{displayedCameras.map((camera, index) => <CameraCard key={camera.id} camera={camera} index={index} total={displayedCameras.length} onPlay={setSelectedCamera} onDelete={async (id) => { await deleteCamera(id); setCameras((current) => current.filter((camera) => camera.id !== id)); }} onMove={moveCamera} onTranscodeChange={async (target, enabled) => { try { const updated = await updateCamera(target, { transcodeH264: enabled }); setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera)); toast.success(`H.264 / AAC transcoding ${enabled ? "enabled" : "disabled"}`); } catch (error: any) { toast.error(error?.message || "Could not update transcoding"); } }} />)}</AnimatePresence></motion.div>}
    </main>
    <AddCameraModal isOpen={isAddModalOpen} initialRegion={authState?.loggedIn ? authState.region : undefined} sharingConfigured={authState?.sharingConfigured ?? false} onClose={() => setIsAddModalOpen(false)} onAdded={() => { void loadAuth(); void loadCameras(true); }} />
    {selectedCamera && <VideoPlayerModal camera={selectedCamera} isOpen onClose={() => setSelectedCamera(null)} />}
  </div>;
}
