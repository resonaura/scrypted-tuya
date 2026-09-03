import {
  Input,
  ListBox,
  Select,
  Skeleton,
  Surface,
  TextField,
} from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Camera as CameraIcon,
  Plus,
  Search,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  deleteCamera,
  fetchAuthState,
  fetchCameras,
  getWsUrl,
  logout,
  refreshCameras,
} from "./api/client.js";
import { AddCameraModal } from "./components/AddCameraModal.js";
import { CameraCard } from "./components/CameraCard.js";
import { Navbar } from "./components/Navbar.js";
import { Button, Card } from "./components/ui/index.js";
import { VideoPlayerModal } from "./components/VideoPlayerModal.js";
import "./styles/tones.css";
import type { AuthState, Camera } from "./types/index.js";

const ORDER_KEY = "tuya-bridge.camera-order.v1";
type CameraFilter = "all" | "online" | "offline";
type CameraSort = "custom" | "name" | "status";

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("tuya-bridge.theme") === "light" ? "light" : "dark",
  );
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraOrder, setCameraOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
    } catch {
      return [];
    }
  });
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
  const wsEverConnectedRef = useRef(false);
  const hasAutoOpenedModalRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tuya-bridge.theme", theme);
  }, [theme]);
  useEffect(
    () => localStorage.setItem(ORDER_KEY, JSON.stringify(cameraOrder)),
    [cameraOrder],
  );

  useEffect(() => {
    if (authState !== null && !hasAutoOpenedModalRef.current) {
      hasAutoOpenedModalRef.current = true;
      if (!authState.loggedIn) {
        setIsAddModalOpen(true);
      }
    }
  }, [authState]);

  const loadAuth = useCallback(async () => {
    try {
      setAuthState(await fetchAuthState());
    } catch {
      setAuthState(null);
    }
  }, []);
  const loadCameras = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const list = await fetchCameras();
      setCameras(list);
      setCameraOrder((current) => [
        ...current.filter((id) => list.some((camera) => camera.id === id)),
        ...list
          .map((camera) => camera.id)
          .filter((id) => !current.includes(id)),
      ]);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || "The bridge did not respond");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
    void loadCameras();
    let disposed = false;
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
          if (disposed) return;
          setIsWsConnected(true);
          toast.dismiss("ws-disconnect");
          if (wsEverConnectedRef.current) {
            toast.success("Bridge reconnected", { duration: 3000 });
          }
          wsEverConnectedRef.current = true;
          void loadCameras(true);
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (
              [
                "session_started",
                "p2p_connected",
                "webrtc_connected",
                "webrtc_disconnected",
                "unhealthy",
              ].includes(data.event)
            )
              void loadCameras(true);
          } catch {}
        };
        ws.onerror = () => {
          if (!disposed) {
            setIsWsConnected(false);
            toast.warning("Bridge disconnected — reconnecting…", {
              id: "ws-disconnect",
              duration: Infinity,
            });
          }
        };
        ws.onclose = () => {
          if (!disposed) {
            setIsWsConnected(false);
            toast.warning("Bridge disconnected — reconnecting…", {
              id: "ws-disconnect",
              duration: Infinity,
            });
            retry = window.setTimeout(connect, 3000);
          }
        };
      } catch {
        retry = window.setTimeout(connect, 3000);
      }
    };
    connect();
    const poll = window.setInterval(() => void loadCameras(true), 20_000);
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
      window.clearInterval(poll);
      ws?.close();
    };
  }, [loadAuth, loadCameras]);

  useEffect(() => {
    if (selectedCamera) {
      const fresh = cameras.find((camera) => camera.id === selectedCamera.id);
      if (fresh) setSelectedCamera(fresh);
    }
  }, [cameras, selectedCamera?.id]);

  const displayedCameras = useMemo(() => {
    const orderIndex = new Map(cameraOrder.map((id, index) => [id, index]));
    const normalized = query.trim().toLowerCase();
    const result = cameras.filter(
      (camera) =>
        (filter === "all" || (filter === "online") === camera.online) &&
        (!normalized ||
          camera.name.toLowerCase().includes(normalized) ||
          camera.did.toLowerCase().includes(normalized)),
    );
    result.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "status"
          ? Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
          : (orderIndex.get(a.id) ?? 1e9) - (orderIndex.get(b.id) ?? 1e9),
    );
    return result;
  }, [cameraOrder, cameras, filter, query, sort]);

  const moveCamera = (id: string, direction: -1 | 1) => {
    const visibleIndex = displayedCameras.findIndex(
      (camera) => camera.id === id,
    );
    const swapWith = displayedCameras[visibleIndex + direction]?.id;
    if (!swapWith) return;
    setSort("custom");
    setCameraOrder((current) => {
      const visibleIds = displayedCameras.map((camera) => camera.id);
      const base =
        sort === "custom"
          ? current
          : [
              ...visibleIds,
              ...current.filter((cameraId) => !visibleIds.includes(cameraId)),
            ];
      const source = base.indexOf(id);
      const target = base.indexOf(swapWith);
      if (source < 0 || target < 0) return current;
      const next = [...base];
      [next[source], next[target]] = [next[target], next[source]];
      return next;
    });
  };

  const handleSync = async () => {
    if (!authState?.loggedIn) {
      setIsAddModalOpen(true);
      toast.info("Connect a Tuya account to discover cloud cameras");
      return;
    }
    setIsRefreshing(true);
    try {
      const response = await refreshCameras();
      setCameras(response.cameras || []);
      await loadAuth();
      toast.success(`Synced ${response.cameras?.length || 0} camera(s)`);
    } catch (error: any) {
      toast.error(error?.message || "Tuya sync failed");
    } finally {
      setIsRefreshing(false);
    }
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

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <Toaster theme={theme} position="top-center" />
      <Navbar
        isWsConnected={isWsConnected}
        authState={authState}
        onAddClick={() => setIsAddModalOpen(true)}
        onRefreshClick={handleSync}
        onLogoutClick={handleLogout}
        isRefreshing={isRefreshing}
        theme={theme}
        onToggleTheme={() =>
          setTheme((value) => (value === "dark" ? "light" : "dark"))
        }
      />
      <main className="mx-auto w-full max-w-375 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Card className="flex flex-row mb-5">
          <div className="flex-1 relative flex items-center">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
            <TextField
              value={query}
              onChange={setQuery}
              aria-label="Search cameras"
              className="w-full"
            >
              <Input
                placeholder="Search by camera name or DID"
                className="pl-9"
              />
            </TextField>
          </div>
          <Select
            selectedKey={filter}
            onSelectionChange={(key) =>
              setFilter((key as CameraFilter) || "all")
            }
            aria-label="Filter cameras"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">All cameras</ListBox.Item>
                <ListBox.Item id="online">Online only</ListBox.Item>
                <ListBox.Item id="offline">Offline only</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            selectedKey={sort}
            onSelectionChange={(key) =>
              setSort((key as CameraSort) || "custom")
            }
            aria-label="Sort cameras"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="custom">Custom order</ListBox.Item>
                <ListBox.Item id="name">Name</ListBox.Item>
                <ListBox.Item id="status">Online first</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </Card>
        {loadError && (
          <Surface className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger/10 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="size-5 text-danger" />
              <div>
                <p className="text-sm font-semibold">
                  Bridge connection failed
                </p>
                <p className="text-xs text-muted-foreground">{loadError}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => void loadCameras()}
            >
              Retry
            </Button>
          </Surface>
        )}
        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <Skeleton
                key={item}
                className="aspect-4/3 opacity-20 rounded-2xl"
              />
            ))}
          </div>
        ) : cameras.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-foreground/5 text-primary">
              <CameraIcon className="size-5 opacity-50" />
            </div>
            <h3 className="text-lg font-semibold">No cameras yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Connect <b>Smart Life</b> or <b>Tuya Smart</b> with QR, or add a
              camera manually.
            </p>
            <Button
              className="mt-5 ml-auto mr-auto"
              variant="accent"
              onPress={() => setIsAddModalOpen(true)}
            >
              <Plus className="size-4" /> Add profile
            </Button>
          </Card>
        ) : displayedCameras.length === 0 ? (
          <Card className="rounded-3xl p-10 text-center flex justify-center">
            <WifiOff className="mx-auto mb-3 size-7 text-muted-foreground" />
            <h3 className="font-semibold">No matching cameras</h3>
            <p className="text-sm text-muted-foreground">
              Change the search or status filter.
            </p>
            <Button
              className="mt-4 ml-auto mr-auto"
              size="sm"
              variant="default-soft"
              onPress={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </Card>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            <AnimatePresence mode="popLayout">
              {displayedCameras.map((camera, index) => (
                <CameraCard
                  key={camera.id}
                  camera={camera}
                  index={index}
                  total={displayedCameras.length}
                  onPlay={setSelectedCamera}
                  onDelete={async (id) => {
                    await deleteCamera(id);
                    setCameras((current) =>
                      current.filter((camera) => camera.id !== id),
                    );
                  }}
                  onMove={moveCamera}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>
      <AddCameraModal
        isOpen={isAddModalOpen}
        initialRegion={authState?.loggedIn ? authState.region : undefined}
        onClose={() => setIsAddModalOpen(false)}
        onAdded={() => {
          void loadAuth();
          void loadCameras(true);
        }}
      />
      {selectedCamera && (
        <VideoPlayerModal
          camera={selectedCamera}
          isOpen
          onClose={() => setSelectedCamera(null)}
        />
      )}
    </div>
  );
}
