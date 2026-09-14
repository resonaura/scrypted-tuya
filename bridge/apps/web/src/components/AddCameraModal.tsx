import {
  cn,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Surface,
  TextField,
} from "@heroui/react";
import { AlertCircle, RefreshCw } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  createCamera,
  pollQr,
  refreshCameras,
  startQrFlow,
} from "../api/client.js";
import { StyledQrCode } from "./StyledQrCode.js";
import { Alert, Button, Tabs } from "./ui/index.js";

export const AddCameraTab = {
  QR: "qr",
  MANUAL: "manual",
} as const;

export type AddCameraTabType = (typeof AddCameraTab)[keyof typeof AddCameraTab];

interface AddCameraModalProps {
  isOpen: boolean;
  initialRegion?: string;
  onClose: () => void;
  onAdded: () => void;
}

const REGIONS = [
  { key: "eu", label: "Western Europe" },
  { key: "we", label: "Eastern Europe" },
  { key: "us", label: "America West" },
  { key: "ue", label: "America East" },
  { key: "cn", label: "China" },
  { key: "in", label: "India" },
] as const;

function resolveInitialRegion(initialRegion?: string): string {
  return (
    initialRegion ||
    localStorage.getItem("tuya-bridge.region") ||
    "us"
  );
}

export const AddCameraModal: React.FC<AddCameraModalProps> = ({
  isOpen,
  initialRegion,
  onClose,
  onAdded,
}) => {
  const [selectedTab, setSelectedTab] = useState<AddCameraTabType>(
    AddCameraTab.QR,
  );
  const [region, setRegion] = useState<string>(() =>
    resolveInitialRegion(initialRegion),
  );

  // QR Flow State
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual Flow State
  const [manualName, setManualName] = useState("");
  const [manualDid, setManualDid] = useState("");
  const [manualLocalKey, setManualLocalKey] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualQuality, setManualQuality] = useState<"hd" | "sd">("hd");
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
  };

  useEffect(() => {
    if (!isOpen) {
      stopPolling();
      return;
    }
    const nextRegion = resolveInitialRegion(initialRegion);
    setRegion(nextRegion);
  }, [initialRegion, isOpen, stopPolling]);

  useEffect(() => {
    localStorage.setItem("tuya-bridge.region", region);
  }, [region]);

  const fetchQr = useCallback(
    async (targetRegion = region) => {
      setIsQrLoading(true);
      setQrToken(null);
      setQrDataUrl(null);
      setQrPayload(null);

      try {
        const res = await startQrFlow(targetRegion);
        setQrToken(res.token);
        setQrDataUrl(res.qrDataUrl);
        setQrPayload(res.qrPayload || `tuyaSmart--qrLogin?token=${res.token}`);
      } catch (e: any) {
        toast.error(`Failed to generate QR: ${e.message}`);
      } finally {
        setIsQrLoading(false);
      }
    },
    [region],
  );

  useEffect(() => {
    if (isOpen && selectedTab === AddCameraTab.QR) {
      fetchQr(region);
    } else {
      stopPolling();
    }
  }, [isOpen, selectedTab, region, fetchQr, stopPolling]);

  useEffect(() => {
    if (!qrToken || !isOpen || selectedTab !== AddCameraTab.QR) {
      stopPolling();
      return;
    }

    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await pollQr(qrToken);
        if (res.loggedIn) {
          stopPolling();
          toast.success("Tuya Smart Life linked successfully!");
          await refreshCameras().catch(() => {});
          onAdded();
          onClose();
        }
      } catch {
        // Ignore network polling errors
      }
    }, 1500);

    return stopPolling;
  }, [qrToken, isOpen, selectedTab, onAdded, onClose, stopPolling]);

  const handleManualSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!manualName || !manualDid) {
      toast.warning("Camera Name and Device ID are required");
      return;
    }

    setIsManualSubmitting(true);
    try {
      await createCamera({
        name: manualName,
        did: manualDid,
        localKey: manualLocalKey,
        ip: manualIp,
        quality: manualQuality,
      });
      toast.success(`Camera ${manualName} added!`);
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to save camera");
    } finally {
      setIsManualSubmitting(false);
    }
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog
          className={cn(
            "rs-card-surface max-h-[90vh] overflow-hidden transition-all duration-200 ease",
            selectedTab === AddCameraTab.QR ? "w-135 h-170" : "w-115 h-135",
          )}
        >
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Connect Tuya profile</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="p-5 overflow-y-auto h-[calc(100%-64px)]">
            <Tabs
              selectedKey={selectedTab}
              onSelectionChange={(key) =>
                setSelectedTab(key as AddCameraTabType)
              }
              className="w-full h-full flex flex-col"
              variant="nav"
            >
              <Tabs.ListContainer className="mb-4 shrink-0">
                <Tabs.List className="w-full grid grid-cols-2">
                  <Tabs.Tab id={AddCameraTab.QR}>
                    <Tabs.Indicator />
                    QR Code
                  </Tabs.Tab>
                  <Tabs.Tab id={AddCameraTab.MANUAL}>
                    <Tabs.Indicator />
                    Manual
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              {/* QR Panel */}
              <Tabs.Panel
                id={AddCameraTab.QR}
                className="space-y-4 flex-1 flex flex-col justify-between"
              >
                <div className="flex items-end gap-2 shrink-0">
                  <div className="flex-1">
                    <Select
                      selectedKey={region}
                      onSelectionChange={(k) =>
                        handleRegionChange((k as string) || "us")
                      }
                    >
                      <Label className="text-xs text-muted-foreground font-medium block">
                        Account Region
                      </Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {REGIONS.map((r) => (
                            <ListBox.Item
                              key={r.key}
                              id={r.key}
                              textValue={r.label}
                            >
                              {r.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <Button
                    size="md"
                    variant="default-soft"
                    onPress={() => fetchQr(region)}
                    isDisabled={isQrLoading}
                    aria-label="Refresh QR"
                  >
                    <RefreshCw
                      className={cn("size-4", isQrLoading && "animate-spin")}
                    />
                  </Button>
                </div>

                <div className="flex flex-col items-center justify-center flex-1 space-y-3">
                  <Surface className="bg-transparent flex flex-col items-center justify-center p-3 rounded-2xl">
                    {isQrLoading ? (
                      <div className="h-55 w-62 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Spinner color="current" size="md" />
                      </div>
                    ) : qrPayload || qrToken || qrDataUrl ? (
                      <div className="flex h-55 w-62 fade-in flex-col items-center gap-2">
                        <StyledQrCode
                          data={
                            qrPayload ||
                            (qrToken
                              ? `tuyaSmart--qrLogin?token=${qrToken}`
                              : "")
                          }
                          size={190}
                        />
                        <p className="mt-1 opacity-70 text-[11px] text-muted-foreground text-center">
                          Scan with <strong>Tuya Smart</strong> or{" "}
                          <strong>Smart Life</strong> app
                        </p>
                      </div>
                    ) : (
                      <div className="h-50 flex flex-col items-center justify-center gap-2 text-rose-500">
                        <AlertCircle className="size-6" />
                        <p className="text-xs font-medium">Failed to load QR</p>
                        <Button size="sm" onPress={() => fetchQr(region)}>
                          Retry
                        </Button>
                      </div>
                    )}
                  </Surface>

                  <Alert
                    status="warning"
                    className="bg-warning-soft! w-full h-fit"
                  >
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title className="font-semibold text-xs text-warning-soft-foreground">
                        Session Advisory
                      </Alert.Title>
                      <Alert.Description className="text-[11px] text-warning-soft-foreground leading-relaxed">
                        Cloud sessions may periodically expire. Re-scan the QR code to re-authenticate, or use the <strong>Manual</strong> tab for persistent local streaming.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                </div>
              </Tabs.Panel>

              {/* Manual Entry Panel */}
              <Tabs.Panel
                id={AddCameraTab.MANUAL}
                className="flex-1 flex flex-col"
              >
                <form
                  onSubmit={handleManualSubmit}
                  className="space-y-3 flex flex-col flex-1 justify-between"
                >
                  <div className="space-y-3">
                    <TextField
                      value={manualName}
                      onChange={setManualName}
                      isRequired
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Camera Name
                      </Label>
                      <Input placeholder="Front Door" />
                    </TextField>

                    <TextField
                      value={manualDid}
                      onChange={setManualDid}
                      isRequired
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Device ID (DID)
                      </Label>
                      <Input placeholder="bf12345678abcdef" />
                    </TextField>

                    <TextField
                      value={manualLocalKey}
                      onChange={setManualLocalKey}
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Local Key (Optional)
                      </Label>
                      <Input placeholder="16-character key" />
                    </TextField>

                    <div className="grid grid-cols-2 gap-2">
                      <TextField value={manualIp} onChange={setManualIp}>
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                          Local IP (Optional)
                        </Label>
                        <Input placeholder="192.168.1.50" />
                      </TextField>

                      <Select
                        selectedKey={manualQuality}
                        onSelectionChange={(k) =>
                          setManualQuality((k as "hd" | "sd") || "hd")
                        }
                      >
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                          Quality
                        </Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="hd" textValue="HD Stream">
                              HD Stream
                            </ListBox.Item>
                            <ListBox.Item id="sd" textValue="SD Stream">
                              SD Stream
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  </div>

                  <div className="pt-3">
                    <Button
                      type="submit"
                      variant="accent"
                      isDisabled={isManualSubmitting}
                      className="w-full font-semibold"
                    >
                      {isManualSubmitting ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        "Save Camera"
                      )}
                    </Button>
                  </div>
                </form>
              </Tabs.Panel>
            </Tabs>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
