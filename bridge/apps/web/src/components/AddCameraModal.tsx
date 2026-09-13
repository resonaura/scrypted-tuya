import type { Key } from "@heroui/react";
import {
  Autocomplete,
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
import { AlertCircle, QrCode, RefreshCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createCamera,
  loginWithPassword,
  pollQr,
  refreshCameras,
  startQrFlow,
} from "../api/client.js";
import {
  POPULAR_COUNTRIES,
  REMAINING_COUNTRIES,
  cleanCountryCode,
} from "../country-codes.js";
import { StyledQrCode } from "./StyledQrCode.js";
import { Alert, Button, Tabs } from "./ui/index.js";

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

function getDefaultCountrySelection(reg: string): string {
  switch (reg) {
    case "eu":
      return "49-DE";
    case "we":
      return "7-RU";
    case "us":
    case "ue":
      return "1-US";
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
  const [selectedTab, setSelectedTab] = useState<string>("qr");
  const [region, setRegion] = useState<string>(
    () => initialRegion || localStorage.getItem("tuya-bridge.region") || "us",
  );

  // QR Flow State
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const pollIntervalRef = useRef<any>(null);

  // Password Flow State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countrySelection, setCountrySelection] = useState<Key | null>(() =>
    getDefaultCountrySelection(
      initialRegion || localStorage.getItem("tuya-bridge.region") || "us",
    ),
  );
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
    const nextRegion =
      initialRegion || localStorage.getItem("tuya-bridge.region") || "us";
    setRegion(nextRegion);
    setCountrySelection(getDefaultCountrySelection(nextRegion));
  }, [initialRegion, isOpen]);

  useEffect(() => {
    localStorage.setItem("tuya-bridge.region", region);
  }, [region]);

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
    setCountrySelection(getDefaultCountrySelection(newRegion));
  };

  const fetchQr = async (selectedRegion = region) => {
    setIsQrLoading(true);
    setQrToken(null);
    setQrDataUrl(null);
    setQrPayload(null);
    try {
      const res = await startQrFlow(selectedRegion);
      setQrToken(res.token);
      setQrDataUrl(res.qrDataUrl);
      setQrPayload(res.qrPayload || `tuyaSmart--qrLogin?token=${res.token}`);
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

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant="blur"
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog className="rs-card-surface sm:max-w-md max-h-[85vh] overflow-y-auto">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-foreground/5 text-primary">
              <QrCode className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Connect Tuya profile</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="p-4">
            <Tabs
              selectedKey={selectedTab}
              onSelectionChange={(key) => setSelectedTab(key as string)}
              className="w-full"
              variant="nav"
            >
              <Tabs.ListContainer className="mb-4">
                <Tabs.List className="w-full grid grid-cols-3">
                  <Tabs.Tab id="qr">
                    <Tabs.Indicator />
                    QR Code
                  </Tabs.Tab>
                  <Tabs.Tab id="password">
                    {" "}
                    <Tabs.Indicator />
                    Password
                  </Tabs.Tab>
                  <Tabs.Tab id="manual">
                    {" "}
                    <Tabs.Indicator />
                    Manual
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              {/* QR Panel */}
              <Tabs.Panel id="qr" className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
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
                  </div>
                  <Button
                    size="md"
                    variant="default-soft"
                    onPress={() => fetchQr(region)}
                    isDisabled={isQrLoading}
                    aria-label="Refresh QR"
                  >
                    <RefreshCw
                      className={`size-4 ${isQrLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </div>

                <Surface className="bg-transparent flex flex-col items-center justify-center p-4 rounded-2xl">
                  {isQrLoading ? (
                    <div className="h-44 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Spinner color="current" size="md" />
                    </div>
                  ) : qrPayload || qrToken || qrDataUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <StyledQrCode
                        data={
                          qrPayload ||
                          (qrToken ? `tuyaSmart--qrLogin?token=${qrToken}` : "")
                        }
                        size={190}
                      />
                      <p className="mt-1 opacity-70 text-[11px] text-muted-foreground text-center">
                        Scan with <strong>Tuya Smart</strong> or{" "}
                        <strong>Smart Life</strong> app
                      </p>
                    </div>
                  ) : (
                    <div className="h-44 flex flex-col items-center justify-center gap-2 text-rose-500">
                      <AlertCircle className="size-6" />
                      <p className="text-xs font-medium">Failed to load QR</p>
                      <Button size="sm" onPress={() => fetchQr(region)}>
                        Retry
                      </Button>
                    </div>
                  )}
                </Surface>

                <Alert status="default" className="p-3 text-xs">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title className="font-semibold text-xs">
                      Session Expiry Note
                    </Alert.Title>
                    <Alert.Description className="text-[11px] text-muted-foreground leading-relaxed">
                      QR authorization tokens may periodically expire on Tuya
                      servers. For uninterrupted 24/7 background streaming and
                      automatic reconnects, logging in with{" "}
                      <strong>Email &amp; Password</strong> in the Password tab
                      is recommended.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              </Tabs.Panel>

              {/* Password Panel */}
              <Tabs.Panel id="password">
                <form onSubmit={handlePasswordSubmit} className="space-y-3">
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
                      onChange={(key) =>
                        key && setCountrySelection(key as string)
                      }
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
                            const country =
                              POPULAR_COUNTRIES.find(
                                (c) => `${c.code}-${c.iso}` === selectedKey,
                              ) ||
                              REMAINING_COUNTRIES.find(
                                (c) => `${c.code}-${c.iso}` === selectedKey,
                              );
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
                      <Autocomplete.Popover className="min-w-[340px] sm:min-w-[380px] max-h-80 overflow-y-auto">
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
                              {POPULAR_COUNTRIES.map((c) => (
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
                              ))}
                            </ListBox.Section>
                            <Separator />
                            <ListBox.Section>
                              <Header className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                All Countries
                              </Header>
                              {REMAINING_COUNTRIES.map((c) => (
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
                              ))}
                            </ListBox.Section>
                          </ListBox>
                        </Autocomplete.Filter>
                      </Autocomplete.Popover>
                    </Autocomplete>
                  </div>

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

                  <Button
                    type="submit"
                    variant="accent"
                    isDisabled={isPasswordLoading}
                    className="w-full font-semibold mt-2"
                  >
                    {isPasswordLoading ? (
                      <Spinner size="sm" />
                    ) : (
                      "Sign In & Discover"
                    )}
                  </Button>
                </form>
              </Tabs.Panel>

              {/* Manual Entry Panel */}
              <Tabs.Panel id="manual">
                <form onSubmit={handleManualSubmit} className="space-y-2.5">
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

                  <Button
                    type="submit"
                    variant="accent"
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
