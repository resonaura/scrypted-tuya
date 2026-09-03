import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  Tabs,
  Button,
  TextField,
  Input,
  Label,
  Select,
  ListBox,
  Spinner,
  Surface,
} from "@heroui/react";
import {
  QrCode,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  startQrFlow,
  pollQr,
  loginWithPassword,
  createCamera,
  refreshCameras,
} from "../api/client.js";
import { toast } from "sonner";

interface AddCameraModalProps {
  isOpen: boolean;
  initialRegion?: string;
  onClose: () => void;
  onAdded: () => void;
}

const REGIONS = [
  { key: "eu", label: "Western Europe (EU)" },
  { key: "we", label: "Eastern Europe (WE)" },
  { key: "us", label: "USA West" },
  { key: "ue", label: "USA East" },
  { key: "cn", label: "China" },
  { key: "in", label: "India" },
];

export const AddCameraModal: React.FC<AddCameraModalProps> = ({
  isOpen,
  initialRegion,
  onClose,
  onAdded,
}) => {
  const [selectedTab, setSelectedTab] = useState<string>("qr");
  const [region, setRegion] = useState<string>(() => initialRegion || localStorage.getItem("tuya-bridge.region") || "us");

  // QR Flow State
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const pollIntervalRef = useRef<any>(null);

  // Password Flow State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState("1");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Manual Camera State
  const [manualName, setManualName] = useState("");
  const [manualDid, setManualDid] = useState("");
  const [manualLocalKey, setManualLocalKey] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualQuality, setManualQuality] = useState<"hd" | "sd">("hd");
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const nextRegion = initialRegion || localStorage.getItem("tuya-bridge.region") || "us";
    setRegion(nextRegion);
  }, [initialRegion, isOpen]);

  useEffect(() => {
    localStorage.setItem("tuya-bridge.region", region);
    if (region === "us" || region === "ue") setCountryCode((current) => current === "49" ? "1" : current);
  }, [region]);

  const fetchQr = async (selectedRegion = region) => {
    setIsQrLoading(true);
    setQrToken(null);
    setQrDataUrl(null);
    try {
      const res = await startQrFlow(selectedRegion);
      setQrToken(res.token);
      setQrDataUrl(res.qrDataUrl);
    } catch (e: any) {
      toast.error(`Failed to generate QR: ${e.message}`);
    } finally {
      setIsQrLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedTab === "qr") {
      fetchQr(region);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, selectedTab, region]);

  useEffect(() => {
    if (qrToken && isOpen && selectedTab === "qr") {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await pollQr(qrToken);
          if (res.loggedIn) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            toast.success("Tuya Smart Life linked successfully!");
            await refreshCameras().catch(() => {});
            onAdded();
            onClose();
          }
        } catch {}
      }, 1500);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [qrToken, isOpen, selectedTab]);

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      toast.warning("Enter email and password");
      return;
    }

    setIsPasswordLoading(true);
    try {
      await loginWithPassword(email, password, countryCode, region);
      toast.success("Logged in successfully!");
      await refreshCameras().catch(() => {});
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Login failed");
    } finally {
      setIsPasswordLoading(false);
    }
  };

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
        <Modal.Dialog className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-primary/10 text-primary">
              <QrCode className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Connect Tuya profile</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="p-4">
            <Tabs
              selectedKey={selectedTab}
              onSelectionChange={(key) => setSelectedTab(key as string)}
              variant="secondary"
              className="w-full"
            >
              <Tabs.ListContainer className="mb-4">
                <Tabs.List className="w-full grid grid-cols-3">
                  <Tabs.Tab id="qr">QR Code</Tabs.Tab>
                  <Tabs.Tab id="password">Password</Tabs.Tab>
                  <Tabs.Tab id="manual">Manual</Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              {/* QR Panel */}
              <Tabs.Panel id="qr" className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select
                      selectedKey={region}
                      onSelectionChange={(k) => setRegion((k as string) || "us")}
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">Account Region</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {REGIONS.map((r) => (
                            <ListBox.Item key={r.key} id={r.key} textValue={r.label}>
                              {r.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <Button
                    size="md"
                    variant="secondary"
                    onPress={() => fetchQr(region)}
                    isDisabled={isQrLoading}
                    aria-label="Refresh QR"
                  >
                    <RefreshCw className={`size-4 ${isQrLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                <Surface className="flex flex-col items-center justify-center p-4 rounded-2xl">
                  {isQrLoading ? (
                    <div className="h-44 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Spinner size="md" />
                    </div>
                  ) : qrDataUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="bg-white p-2.5 rounded-2xl shadow-sm">
                        <img
                          src={qrDataUrl}
                          alt="Tuya Login QR"
                          className="size-40 object-contain"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        Scan with <strong>Tuya Smart</strong> or <strong>Smart Life</strong> app
                      </p>
                    </div>
                  ) : (
                    <div className="h-44 flex flex-col items-center justify-center gap-2 text-rose-500">
                      <AlertCircle className="size-6" />
                      <p className="text-xs font-medium">Failed to load QR</p>
                      <Button size="sm" variant="secondary" onPress={() => fetchQr(region)}>
                        Retry
                      </Button>
                    </div>
                  )}
                </Surface>
              </Tabs.Panel>

              {/* Password Panel */}
              <Tabs.Panel id="password">
                <form onSubmit={handlePasswordSubmit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      selectedKey={region}
                      onSelectionChange={(k) => setRegion((k as string) || "us")}
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">Region</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {REGIONS.map((r) => (
                            <ListBox.Item key={r.key} id={r.key} textValue={r.label}>
                              {r.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    <TextField value={countryCode} onChange={setCountryCode} variant="secondary">
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">Country Code</Label>
                      <Input placeholder="49" variant="secondary" />
                    </TextField>
                  </div>

                  <TextField value={email} onChange={setEmail} isRequired variant="secondary">
                    <Label className="text-xs text-muted-foreground font-medium mb-1 block">Email or User</Label>
                    <Input placeholder="name@example.com" variant="secondary" />
                  </TextField>

                  <TextField value={password} onChange={setPassword} type="password" isRequired variant="secondary">
                    <Label className="text-xs text-muted-foreground font-medium mb-1 block">Password</Label>
                    <Input type="password" placeholder="••••••••" variant="secondary" />
                  </TextField>

                  <Button
                    type="submit"
                    variant="primary"
                    isDisabled={isPasswordLoading}
                    className="w-full font-semibold mt-2"
                  >
                    {isPasswordLoading ? <Spinner size="sm" /> : "Sign In & Discover"}
                  </Button>
                </form>
              </Tabs.Panel>

              {/* Manual Entry Panel */}
              <Tabs.Panel id="manual">
                <form onSubmit={handleManualSubmit} className="space-y-2.5">
                  <TextField value={manualName} onChange={setManualName} isRequired variant="secondary">
                    <Label className="text-xs text-muted-foreground font-medium mb-1 block">Camera Name</Label>
                    <Input placeholder="Front Door" variant="secondary" />
                  </TextField>

                  <TextField value={manualDid} onChange={setManualDid} isRequired variant="secondary">
                    <Label className="text-xs text-muted-foreground font-medium mb-1 block">Device ID (DID)</Label>
                    <Input placeholder="bf12345678abcdef" variant="secondary" />
                  </TextField>

                  <TextField value={manualLocalKey} onChange={setManualLocalKey} variant="secondary">
                    <Label className="text-xs text-muted-foreground font-medium mb-1 block">Local Key (Optional)</Label>
                    <Input placeholder="16-character key" variant="secondary" />
                  </TextField>

                  <div className="grid grid-cols-2 gap-2">
                    <TextField value={manualIp} onChange={setManualIp} variant="secondary">
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">Local IP (Optional)</Label>
                      <Input placeholder="192.168.1.50" variant="secondary" />
                    </TextField>
                    <Select
                      selectedKey={manualQuality}
                      onSelectionChange={(k) => setManualQuality((k as "hd" | "sd") || "hd")}
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">Quality</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="hd" textValue="HD Stream">HD Stream</ListBox.Item>
                          <ListBox.Item id="sd" textValue="SD Stream">SD Stream</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    isDisabled={isManualSubmitting}
                    className="w-full font-semibold mt-2"
                  >
                    {isManualSubmitting ? <Spinner size="sm" /> : "Save Camera"}
                  </Button>
                </form>
              </Tabs.Panel>
            </Tabs>
          </Modal.Body>


        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
