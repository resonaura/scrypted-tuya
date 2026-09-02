import { useState, useEffect, useCallback } from "react";
import { Button, Surface, Chip, Spinner } from "@heroui/react";
import { Navbar } from "./components/Navbar.js";
import { StatsBanner } from "./components/StatsBanner.js";
import { CameraCard } from "./components/CameraCard.js";
import { AddCameraModal } from "./components/AddCameraModal.js";
import { VideoPlayerModal } from "./components/VideoPlayerModal.js";
import {
  fetchCameras,
  deleteCamera,
  ptzCamera,
  fetchAuthState,
  refreshCameras,
  logout,
  getWsUrl,
} from "./api/client.js";
import type { Camera, AuthState } from "./types/index.js";
import { Toaster, toast } from "sonner";
import { Plus, QrCode } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
    }
  };

  const loadAuth = useCallback(async () => {
    try {
      const state = await fetchAuthState();
      setAuthState(state);
    } catch {}
  }, []);

  const loadCameras = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const list = await fetchCameras();
      setCameras(list);
    } catch {
      if (!quiet) toast.error("Failed to load cameras");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleSyncTuya = async () => {
    if (!authState?.loggedIn) {
      setIsAddModalOpen(true);
      toast.info("Please connect your Tuya account first.");
      return;
    }
    setIsRefreshing(true);
    try {
      const res = await refreshCameras();
      setCameras(res.cameras || []);
      await loadAuth();
      toast.success(`Synced ${res.cameras?.length || 0} camera(s)!`);
    } catch (e: any) {
      toast.error(e.message || "Failed to sync with Tuya Cloud");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      await loadAuth();
      setCameras([]);
      toast.info("Logged out from Tuya Cloud.");
    } catch {
      toast.error("Logout failed");
    }
  };

  useEffect(() => {
    loadAuth();
    loadCameras();

    const wsUrl = getWsUrl();
    let ws: WebSocket | null = null;
    let retryTimeout: any = null;

    const connectWs = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setIsWsConnected(true);
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (
              data.event === "session_started" ||
              data.event === "p2p_connected"
            ) {
              loadCameras(true);
            }
          } catch {}
        };

        ws.onclose = () => {
          setIsWsConnected(false);
          retryTimeout = setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          setIsWsConnected(false);
        };
      } catch {
        retryTimeout = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      if (ws) ws.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [loadCameras, loadAuth]);

  const handleDeleteCamera = async (id: string) => {
    await deleteCamera(id);
    setCameras((prev) => prev.filter((c) => c.id !== id));
  };

  const handlePtz = async (
    id: string,
    dir: "up" | "down" | "left" | "right" | "stop",
  ) => {
    try {
      await ptzCamera(id, dir);
    } catch {
      toast.error("PTZ command failed");
    }
  };

  const onlineCount = cameras.filter((c) => c.online).length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20">
      <Toaster theme={theme} position="top-right" richColors />

      <Navbar
        onlineCount={onlineCount}
        totalCount={cameras.length}
        isWsConnected={isWsConnected}
        authState={authState}
        onAddClick={() => setIsAddModalOpen(true)}
        onRefreshClick={handleSyncTuya}
        onLogoutClick={handleLogout}
        isRefreshing={isRefreshing}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <StatsBanner
          totalCameras={cameras.length}
          onlineCameras={onlineCount}
        />

        {/* Section Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Connected Cameras</h2>
              {authState?.loggedIn && (
                <Chip size="sm" variant="soft" color="accent" className="text-[10px] font-semibold h-5 px-2">
                  Cloud Linked
                </Chip>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Ultra-low latency RTSP video pipeline powered by Tuya Protect & C++23 native core
            </p>
          </div>

          <Button
            size="sm"
            variant="primary"
            onPress={() => setIsAddModalOpen(true)}
            className="text-xs font-semibold shadow-sm"
          >
            <Plus className="size-3.5 mr-1" />
            Add Camera
          </Button>
        </div>

        {/* Camera List / Empty State */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <Spinner size="lg" />
            <p className="text-xs">Connecting to Tuya Bridge...</p>
          </div>
        ) : cameras.length === 0 ? (
          <Surface className="rounded-3xl p-12 text-center flex flex-col items-center justify-center gap-3 shadow-xs">
            <div className="p-3.5 rounded-2xl bg-primary/10 text-primary">
              <QrCode className="size-8" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="font-bold text-base">No Cameras Connected Yet</h3>
              <p className="text-xs text-muted-foreground">
                Connect your Tuya Smart or Smart Life account via QR code to automatically import all your cameras with RTSP streaming!
              </p>
            </div>
            <Button
              size="md"
              variant="primary"
              onPress={() => setIsAddModalOpen(true)}
              className="font-semibold text-xs mt-2 px-5 py-2.5 rounded-xl shadow-sm"
            >
              <Plus className="size-4 mr-1.5" />
              Connect Tuya Account
            </Button>
          </Surface>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            <AnimatePresence>
              {cameras.map((camera) => (
                <CameraCard
                  key={camera.id}
                  camera={camera}
                  onPlay={(cam) => setSelectedCamera(cam)}
                  onDelete={handleDeleteCamera}
                  onPtz={handlePtz}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      <AddCameraModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdded={() => {
          loadAuth();
          loadCameras(true);
        }}
      />

      {selectedCamera && (
        <VideoPlayerModal
          camera={selectedCamera}
          isOpen={!!selectedCamera}
          onClose={() => setSelectedCamera(null)}
          onPtz={handlePtz}
        />
      )}
    </div>
  );
}
