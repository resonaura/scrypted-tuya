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
  CheckCircle2,
  Music,
  ArrowRight,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  startQrFlow,
  pollQr,
  loginWithPassword,
  createCamera,
  refreshCameras,
  startSharingQr,
  pollSharingQr,
} from "../api/client.js";
import { toast } from "sonner";

interface AddCameraModalProps {
  isOpen: boolean;
  initialRegion?: string;
  sharingConfigured?: boolean;
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

type Step = "login" | "cloud-audio";

export const AddCameraModal: React.FC<AddCameraModalProps> = ({
  isOpen,
  initialRegion,
  sharingConfigured,
  onClose,
  onAdded,
}) => {
  const [step, setStep] = useState<Step>("login");
  const [selectedTab, setSelectedTab] = useState<string>("qr");
  const [region, setRegion] = useState<string>(
    () => initialRegion || localStorage.getItem("tuya-bridge.region") || "us",
  );

  // Step 1 — QR Flow
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const pollIntervalRef = useRef<any>(null);

  // Step 1 — Password Flow
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState("1");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Step 1 — Manual Camera
  const [manualName, setManualName] = useState("");
  const [manualDid, setManualDid] = useState("");
  const [manualLocalKey, setManualLocalKey] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualQuality, setManualQuality] = useState<"hd" | "sd">("hd");
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  // Step 2 — Cloud Audio (Smart Life Sharing)
  const [sharingUserCode, setSharingUserCode] = useState<string>(
    () => localStorage.getItem("tuya-bridge.userCode") || "",
  );
  const [sharingQrDataUrl, setSharingQrDataUrl] = useState<string | null>(null);
  const [isSharingQrLoading, setIsSharingQrLoading] = useState(false);
  const [sharingLinked, setSharingLinked] = useState(sharingConfigured ?? false);
  const sharingPollRef = useRef<any>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep("login");
      setQrToken(null);
      setQrDataUrl(null);
      setSharingQrDataUrl(null);
      setSharingLinked(sharingConfigured ?? false);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (sharingPollRef.current) clearInterval(sharingPollRef.current);
      return;
    }
    const nextRegion =
      initialRegion || localStorage.getItem("tuya-bridge.region") || "us";
    setRegion(nextRegion);
  }, [initialRegion, isOpen, sharingConfigured]);

  useEffect(() => {
    localStorage.setItem("tuya-bridge.region", region);
    if (region === "us" || region === "ue")
      setCountryCode((c) => (c === "49" ? "1" : c));
  }, [region]);

  // ── Step 1: QR Flow ───────────────────────────────────────
  const fetchQr = async (r = region) => {
    setIsQrLoading(true);
    setQrToken(null);
    setQrDataUrl(null);
    try {
      const res = await startQrFlow(r);
      setQrToken(res.token);
      setQrDataUrl(res.qrDataUrl);
    } catch (e: any) {
      toast.error(`Failed to generate QR code: ${e.message}`);
    } finally {
      setIsQrLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedTab === "qr" && step === "login") {
      fetchQr(region);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, selectedTab, region, step]);

  useEffect(() => {
    if (qrToken && isOpen && selectedTab === "qr" && step === "login") {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await pollQr(qrToken);
          if (res.loggedIn) {
            clearInterval(pollIntervalRef.current);
            toast.success("Tuya account connected");
            await refreshCameras().catch(() => {});
            onAdded();
            setStep("cloud-audio");
          }
        } catch {}
      }, 1500);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [qrToken, isOpen, selectedTab, step]);

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      toast.warning("Please enter your email and password");
      return;
    }
    setIsPasswordLoading(true);
    try {
      await loginWithPassword(email, password, countryCode, region);
      toast.success("Signed in successfully");
      await refreshCameras().catch(() => {});
      onAdded();
      setStep("cloud-audio");
    } catch (e: any) {
      toast.error(e.message || "Authentication failed");
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
        transcodeH264: false,
      });
      toast.success(`Camera ${manualName} saved`);
      onAdded();
      setStep("cloud-audio");
    } catch (e: any) {
      toast.error(e.message || "Failed to save camera");
    } finally {
      setIsManualSubmitting(false);
    }
  };

  // ── Step 2: Cloud Audio QR Flow ───────────────────────────
  const fetchSharingQr = async () => {
    const code = sharingUserCode.trim();
    if (!code) {
      toast.warning("Please enter your Smart Life User Code");
      return;
    }
    localStorage.setItem("tuya-bridge.userCode", code);
    setIsSharingQrLoading(true);
    setSharingQrDataUrl(null);
    if (sharingPollRef.current) clearInterval(sharingPollRef.current);

    try {
      const res = await startSharingQr(code);
      setSharingQrDataUrl(res.qrDataUrl);

      sharingPollRef.current = setInterval(async () => {
        try {
          const poll = await pollSharingQr(res.qrcode, code);
          if (poll.success) {
            clearInterval(sharingPollRef.current);
            setSharingLinked(true);
            toast.success(
              `Cloud Audio linked successfully${poll.username ? ` (${poll.username})` : ""}`,
            );
          }
        } catch {}
      }, 1500);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate Cloud Audio QR code");
    } finally {
      setIsSharingQrLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (sharingPollRef.current) clearInterval(sharingPollRef.current);
    };
  }, []);

  const handleClose = () => {
    if (sharingPollRef.current) clearInterval(sharingPollRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    onClose();
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      variant="blur"
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <Modal.CloseTrigger onPress={handleClose} />

          <Modal.Header className="flex flex-col items-start gap-3 pb-2">
            {/* Step navigation bar */}
            <div className="flex items-center gap-2 w-full pt-1">
              <div
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${
                  step === "login"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-success/15 text-success"
                }`}
              >
                {step !== "login" ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <span className="size-3.5 flex items-center justify-center text-[11px] font-bold">1</span>
                )}
                <span>Tuya Account</span>
              </div>

              <ChevronRight className="size-3.5 text-muted-foreground/60" />

              <div
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${
                  step === "cloud-audio"
                    ? sharingLinked
                      ? "bg-success/15 text-success"
                      : "bg-primary text-primary-foreground shadow-sm"
                    : "bg-default-100 text-muted-foreground/60"
                }`}
              >
                {sharingLinked ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <span className="size-3.5 flex items-center justify-center text-[11px] font-bold">2</span>
                )}
                <span>Cloud Audio</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 mt-1">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                {step === "login" ? (
                  <QrCode className="size-5" />
                ) : (
                  <Music className="size-5" />
                )}
              </div>
              <div>
                <Modal.Heading className="text-lg font-bold">
                  {step === "login"
                    ? "Connect Tuya Account"
                    : "Sync Cloud Audio"}
                </Modal.Heading>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step === "login"
                    ? "Sign in to discover your cameras and configure P2P streaming"
                    : "Authorize Smart Life Sharing for high-fidelity, uninterrupted audio"}
                </p>
              </div>
            </div>
          </Modal.Header>

          <Modal.Body className="p-4 pt-2">
            {/* ── STEP 1: Login ── */}
            {step === "login" && (
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

                {/* QR Tab */}
                <Tabs.Panel id="qr" className="space-y-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Select
                        selectedKey={region}
                        onSelectionChange={(k) =>
                          setRegion((k as string) || "us")
                        }
                      >
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
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
                      variant="secondary"
                      onPress={() => fetchQr(region)}
                      isDisabled={isQrLoading}
                      aria-label="Refresh QR"
                    >
                      <RefreshCw
                        className={`size-4 ${isQrLoading ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </div>

                  <Surface className="flex flex-col items-center justify-center p-4 rounded-2xl border border-default-200/60 bg-content1/50">
                    {isQrLoading ? (
                      <div className="h-44 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Spinner size="md" />
                        <span className="text-xs">Generating QR code...</span>
                      </div>
                    ) : qrDataUrl ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <div className="bg-white p-2.5 rounded-2xl shadow-sm">
                          <img
                            src={qrDataUrl}
                            alt="Tuya Login QR"
                            className="size-44 object-contain"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-center">
                          Scan using the built-in scanner in{" "}
                          <strong>Tuya Smart</strong> or <strong>Smart Life</strong> app
                        </p>
                      </div>
                    ) : (
                      <div className="h-44 flex flex-col items-center justify-center gap-2 text-rose-500">
                        <AlertCircle className="size-6" />
                        <p className="text-xs font-medium">Failed to load QR code</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => fetchQr(region)}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                  </Surface>
                </Tabs.Panel>

                {/* Password Tab */}
                <Tabs.Panel id="password">
                  <form onSubmit={handlePasswordSubmit} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        selectedKey={region}
                        onSelectionChange={(k) =>
                          setRegion((k as string) || "us")
                        }
                      >
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                          Region
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
                      <TextField
                        value={countryCode}
                        onChange={setCountryCode}
                        variant="secondary"
                      >
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                          Country Code
                        </Label>
                        <Input placeholder="1" variant="secondary" />
                      </TextField>
                    </div>
                    <TextField
                      value={email}
                      onChange={setEmail}
                      isRequired
                      variant="secondary"
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Email or Username
                      </Label>
                      <Input
                        placeholder="name@example.com"
                        variant="secondary"
                      />
                    </TextField>
                    <TextField
                      value={password}
                      onChange={setPassword}
                      type="password"
                      isRequired
                      variant="secondary"
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Password
                      </Label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        variant="secondary"
                      />
                    </TextField>
                    <Button
                      type="submit"
                      variant="primary"
                      isDisabled={isPasswordLoading}
                      className="w-full font-semibold mt-2"
                    >
                      {isPasswordLoading ? (
                        <Spinner size="sm" />
                      ) : (
                        <>
                          Sign In & Continue
                          <ArrowRight className="size-4 ml-1" />
                        </>
                      )}
                    </Button>
                  </form>
                </Tabs.Panel>

                {/* Manual Tab */}
                <Tabs.Panel id="manual">
                  <form onSubmit={handleManualSubmit} className="space-y-2.5">
                    <TextField
                      value={manualName}
                      onChange={setManualName}
                      isRequired
                      variant="secondary"
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Camera Name
                      </Label>
                      <Input placeholder="Front Door" variant="secondary" />
                    </TextField>
                    <TextField
                      value={manualDid}
                      onChange={setManualDid}
                      isRequired
                      variant="secondary"
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Device ID (DID)
                      </Label>
                      <Input
                        placeholder="bf12345678abcdef"
                        variant="secondary"
                      />
                    </TextField>
                    <TextField
                      value={manualLocalKey}
                      onChange={setManualLocalKey}
                      variant="secondary"
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Local Key (Optional)
                      </Label>
                      <Input
                        placeholder="16-character key"
                        variant="secondary"
                      />
                    </TextField>
                    <div className="grid grid-cols-2 gap-2">
                      <TextField
                        value={manualIp}
                        onChange={setManualIp}
                        variant="secondary"
                      >
                        <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                          Local IP (Optional)
                        </Label>
                        <Input
                          placeholder="192.168.1.50"
                          variant="secondary"
                        />
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
                    <Button
                      type="submit"
                      variant="primary"
                      isDisabled={isManualSubmitting}
                      className="w-full font-semibold mt-2"
                    >
                      {isManualSubmitting ? (
                        <Spinner size="sm" />
                      ) : (
                        <>
                          Save & Continue
                          <ArrowRight className="size-4 ml-1" />
                        </>
                      )}
                    </Button>
                  </form>
                </Tabs.Panel>
              </Tabs>
            )}

            {/* ── STEP 2: Cloud Audio ── */}
            {step === "cloud-audio" && (
              <div className="space-y-4">
                {sharingLinked ? (
                  <Surface className="flex flex-col items-center gap-3 p-6 rounded-2xl text-center border border-success/30 bg-success/5">
                    <div className="p-3 rounded-full bg-success/15 text-success">
                      <CheckCircle2 className="size-8" />
                    </div>
                    <div>
                      <h4 className="font-bold text-base">Cloud Audio Connected</h4>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                        Your RTSP streams now merge local high-definition video with
                        crystal-clear audio from Tuya Cloud.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      className="w-full font-semibold mt-2"
                      onPress={handleClose}
                    >
                      Finish
                    </Button>
                  </Surface>
                ) : (
                  <>
                    <Surface className="rounded-2xl p-3.5 border border-primary/20 bg-primary/5 flex items-start gap-2.5">
                      <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        This one-time authorization connects the Smart Life Sharing API
                        to provide stable, continuous cloud audio alongside your local HD video.
                      </p>
                    </Surface>

                    <div className="space-y-2">
                      <TextField
                        value={sharingUserCode}
                        onChange={setSharingUserCode}
                        variant="secondary"
                      >
                        <Label className="text-xs font-medium mb-1 block">
                          User Code
                        </Label>
                        <Input
                          placeholder="e.g. eu12345678"
                          variant="secondary"
                          autoCapitalize="none"
                        />
                      </TextField>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Find it in the <strong>Smart Life app → Me → Settings ⚙️ → Account and Security → User Code</strong>
                      </p>
                    </div>

                    {!sharingQrDataUrl ? (
                      <Button
                        variant="primary"
                        className="w-full font-semibold"
                        onPress={fetchSharingQr}
                        isDisabled={isSharingQrLoading || !sharingUserCode.trim()}
                      >
                        {isSharingQrLoading ? (
                          <div className="flex items-center gap-2">
                            <Spinner size="sm" />
                            <span>Generating QR code...</span>
                          </div>
                        ) : (
                          <>
                            <QrCode className="size-4 mr-1.5" />
                            Generate QR Code
                          </>
                        )}
                      </Button>
                    ) : (
                      <Surface className="flex flex-col items-center gap-2.5 p-4 rounded-2xl border border-default-200/60 bg-content1/50">
                        <div className="bg-white p-2.5 rounded-2xl shadow-sm">
                          <img
                            src={sharingQrDataUrl}
                            alt="Smart Life Sharing QR"
                            className="size-44 object-contain"
                          />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                          <Spinner size="sm" />
                          <span>Waiting for scan in Smart Life app...</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground text-center">
                          Scan using the built-in scanner in the <strong>Smart Life</strong> app
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-muted-foreground"
                          onPress={fetchSharingQr}
                        >
                          Generate New Code
                        </Button>
                      </Surface>
                    )}

                    <div className="pt-1 flex items-center justify-between">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground"
                        onPress={() => setStep("login")}
                      >
                        Back to Step 1
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground"
                        onPress={handleClose}
                      >
                        Skip (Use local P2P audio)
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
