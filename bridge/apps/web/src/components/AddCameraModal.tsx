import type { Key } from "@heroui/react";
import {
  Autocomplete,
  cn,
  EmptyState,
  Header,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Separator,
  Spinner,
  Surface,
  TextField,
  useFilter,
} from "@heroui/react";
import { AlertCircle, RefreshCw } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  createCamera,
  loginWithPassword,
  pollQr,
  refreshCameras,
  startQrFlow,
} from "../api/client.js";
import {
  cleanCountryCode,
  detectUserLocation,
  POPULAR_COUNTRIES,
  REMAINING_COUNTRIES,
  type Country,
} from "../country-codes.js";
import { StyledQrCode } from "./StyledQrCode.js";
import { Alert, Button, Tabs } from "./ui/index.js";

export const AddCameraTab = {
  QR: "qr",
  PASSWORD: "password",
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
  { key: "eu", label: "Western Europe (EU)" },
  { key: "we", label: "Eastern Europe (WE)" },
  { key: "us", label: "USA West" },
  { key: "ue", label: "USA East" },
  { key: "cn", label: "China" },
  { key: "in", label: "India" },
] as const;

const EU_FALLBACK_ISOS = new Set([
  "UA",
  "PL",
  "DE",
  "FR",
  "GB",
  "IT",
  "ES",
  "NL",
  "CH",
  "AT",
  "SE",
  "NO",
]);

function resolveInitialRegion(initialRegion?: string): string {
  return (
    initialRegion ||
    localStorage.getItem("tuya-bridge.region") ||
    detectUserLocation().region ||
    "us"
  );
}

function getDefaultCountrySelection(reg: string): string {
  const detected = detectUserLocation();

  if (detected.region === reg) return detected.countryKey;
  if (
    (reg === "us" || reg === "ue") &&
    (detected.iso === "US" || detected.iso === "CA")
  ) {
    return detected.countryKey;
  }

  switch (reg) {
    case "eu":
      return detected.iso && EU_FALLBACK_ISOS.has(detected.iso)
        ? detected.countryKey
        : "49-DE";
    case "we":
      return "7-RU";
    case "cn":
      return "86-CN";
    case "in":
      return "91-IN";
    default:
      return "1-US";
  }
}

export const AddCameraModal: React.FC<AddCameraModalProps> = ({
  isOpen,
  initialRegion,
  onClose,
  onAdded,
}) => {
  const { contains } = useFilter({ sensitivity: "base" });

  const [selectedTab, setSelectedTab] = useState<AddCameraTabType>(
    AddCameraTab.QR,
  );
  const [region, setRegion] = useState<string>(() =>
    resolveInitialRegion(initialRegion),
  );
  const [countrySelection, setCountrySelection] = useState<Key | null>(() =>
    getDefaultCountrySelection(resolveInitialRegion(initialRegion)),
  );

  // QR Flow State
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Password Flow State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Manual Flow State
  const [manualName, setManualName] = useState("");
  const [manualDid, setManualDid] = useState("");
  const [manualLocalKey, setManualLocalKey] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualQuality, setManualQuality] = useState<"hd" | "sd">("hd");
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  // O(1) lookup map для стран
  const countriesMap = useMemo(() => {
    const map = new Map<string, Country>();
    for (const c of POPULAR_COUNTRIES) map.set(`${c.code}-${c.iso}`, c);
    for (const c of REMAINING_COUNTRIES) map.set(`${c.code}-${c.iso}`, c);
    return map;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
    setCountrySelection(getDefaultCountrySelection(newRegion));
  };

  const handleCountryChange = (key: Key | null) => {
    if (!key) return;
    const strKey = String(key);
    setCountrySelection(strKey);
    const country = countriesMap.get(strKey);
    if (!country) return;

    if (country.iso === "US" || country.iso === "CA") {
      if (region !== "us" && region !== "ue") {
        setRegion("us");
      }
    } else if (
      EU_FALLBACK_ISOS.has(country.iso) ||
      country.code === "49" ||
      country.code === "33" ||
      country.code === "44"
    ) {
      if (region !== "eu" && region !== "we") {
        setRegion("eu");
      }
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopPolling();
      return;
    }
    const nextRegion = resolveInitialRegion(initialRegion);
    setRegion(nextRegion);
    setCountrySelection(getDefaultCountrySelection(nextRegion));
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
        // Игнорируем сетевые ошибки поллинга
      }
    }, 1500);

    return stopPolling;
  }, [qrToken, isOpen, selectedTab, onAdded, onClose, stopPolling]);

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      toast.warning("Enter email and password");
      return;
    }

    const countryKey = String(countrySelection || "1-US");
    const numericCode = cleanCountryCode(countryKey.split("-")[0] || "1");

    setIsPasswordLoading(true);
    try {
      await loginWithPassword(email, password, numericCode, region);
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

  const renderCountryItem = (c: Country) => (
    <ListBox.Item
      key={`${c.code}-${c.iso}`}
      id={`${c.code}-${c.iso}`}
      textValue={`${c.flag} ${c.name} (+${c.code})`}
    >
      <div className="flex items-center justify-between w-full gap-2 text-left pr-6">
        <span className="truncate">
          {c.flag} {c.name}
        </span>
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          +{c.code}
        </span>
      </div>
      <ListBox.ItemIndicator />
    </ListBox.Item>
  );

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
            selectedTab === AddCameraTab.QR ? "w-135 h-167.5" : "w-115 h-130",
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
                <Tabs.List className="w-full grid grid-cols-3">
                  <Tabs.Tab id={AddCameraTab.QR}>
                    <Tabs.Indicator />
                    QR Code
                  </Tabs.Tab>
                  <Tabs.Tab id={AddCameraTab.PASSWORD}>
                    <Tabs.Indicator />
                    Password
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
                        Session Expiry Note
                      </Alert.Title>
                      <Alert.Description className="text-[11px] text-warning-soft-foreground leading-relaxed">
                        QR authorization tokens may periodically expire on Tuya
                        servers. For uninterrupted 24/7 background streaming,
                        logging in with <strong>Email &amp; Password</strong> in
                        the Password tab is recommended.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                </div>
              </Tabs.Panel>

              {/* Password Panel */}
              <Tabs.Panel
                id={AddCameraTab.PASSWORD}
                className="flex-1 flex flex-col"
              >
                <form
                  onSubmit={handlePasswordSubmit}
                  className="space-y-3 flex flex-col flex-1 justify-between"
                >
                  <div className="space-y-3">
                    <Select
                      selectedKey={region}
                      onSelectionChange={(k) =>
                        handleRegionChange((k as string) || "us")
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

                    <Autocomplete
                      className="w-full"
                      placeholder="Select country"
                      selectionMode="single"
                      value={countrySelection}
                      onChange={handleCountryChange}
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Country
                      </Label>
                      <Autocomplete.Trigger>
                        <Autocomplete.Value>
                          {({ defaultChildren, isPlaceholder, state }) => {
                            if (
                              isPlaceholder ||
                              state.selectedItems.length === 0
                            ) {
                              return defaultChildren;
                            }
                            const selectedKey = state.selectedItems[0]?.key;
                            const country = selectedKey
                              ? countriesMap.get(String(selectedKey))
                              : null;
                            if (!country) return defaultChildren;

                            return (
                              <div className="flex items-center justify-between w-full gap-2 text-left pr-2">
                                <span className="truncate">
                                  {country.flag} {country.name}
                                </span>
                                <span className="text-xs text-muted-foreground font-mono shrink-0">
                                  +{country.code}
                                </span>
                              </div>
                            );
                          }}
                        </Autocomplete.Value>
                        <Autocomplete.Indicator />
                      </Autocomplete.Trigger>

                      <Autocomplete.Popover className="min-w-85 sm:min-w-95 max-h-80 overflow-y-auto">
                        <Autocomplete.Filter filter={contains}>
                          <SearchField
                            autoFocus
                            aria-label="Search countries"
                            name="search"
                            variant="secondary"
                          >
                            <SearchField.Group>
                              <SearchField.SearchIcon />
                              <SearchField.Input placeholder="Search country or code..." />
                              <SearchField.ClearButton />
                            </SearchField.Group>
                          </SearchField>

                          <ListBox
                            renderEmptyState={() => (
                              <EmptyState className="p-3 text-xs text-muted-foreground text-center">
                                No countries found
                              </EmptyState>
                            )}
                          >
                            <ListBox.Section>
                              <Header className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                Popular
                              </Header>
                              {POPULAR_COUNTRIES.map(renderCountryItem)}
                            </ListBox.Section>
                            <Separator />
                            <ListBox.Section>
                              <Header className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                All Countries
                              </Header>
                              {REMAINING_COUNTRIES.map(renderCountryItem)}
                            </ListBox.Section>
                          </ListBox>
                        </Autocomplete.Filter>
                      </Autocomplete.Popover>
                    </Autocomplete>

                    <TextField value={email} onChange={setEmail} isRequired>
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Email or User
                      </Label>
                      <Input placeholder="name@example.com" />
                    </TextField>

                    <TextField
                      value={password}
                      onChange={setPassword}
                      type="password"
                      isRequired
                    >
                      <Label className="text-xs text-muted-foreground font-medium mb-1 block">
                        Password
                      </Label>
                      <Input type="password" placeholder="••••••••" />
                    </TextField>

                    <Alert status="default" className="py-2 px-3 text-xs bg-muted/40 border border-border/50">
                      <Alert.Content>
                        <Alert.Description className="text-[11px] leading-relaxed text-muted-foreground">
                          💡 Match Country &amp; Region with your Smart Life registration (e.g. Canada/US use dial code +1 and USA West/East). If you registered via Google or Apple ID, use the <strong>QR Code</strong> tab for instant 1-click login.
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  </div>

                  <div className="pt-3">
                    <Button
                      type="submit"
                      variant="accent"
                      isDisabled={isPasswordLoading}
                      className="w-full font-semibold"
                    >
                      {isPasswordLoading ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        "Sign In & Discover"
                      )}
                    </Button>
                  </div>
                </form>
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
