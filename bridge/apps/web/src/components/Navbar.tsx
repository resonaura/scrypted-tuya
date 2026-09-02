import React from "react";
import {
  Button,
  Chip,
  Dropdown,
  Label,
  Description,
  Avatar,
} from "@heroui/react";
import {
  Video,
  Plus,
  Moon,
  Sun,
  RefreshCw,
  LogOut,
  Globe,
  Radio,
} from "lucide-react";
import type { AuthState } from "../types/index.js";

interface NavbarProps {
  onlineCount: number;
  totalCount: number;
  isWsConnected: boolean;
  authState: AuthState | null;
  onAddClick: () => void;
  onRefreshClick: () => void;
  onLogoutClick: () => void;
  isRefreshing: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onlineCount,
  totalCount,
  isWsConnected,
  authState,
  onAddClick,
  onRefreshClick,
  onLogoutClick,
  isRefreshing,
  theme,
  onToggleTheme,
}) => {
  const isLoggedIn = Boolean(authState?.loggedIn && authState?.user);
  const userDisplay =
    authState?.user?.email ||
    authState?.user?.nickname ||
    authState?.user?.uid ||
    "Tuya User";
  const userInitials = userDisplay.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-background/80 px-4 sm:px-8 py-3 flex items-center justify-between">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="relative p-2 rounded-xl bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
          <Video className="size-5" />
          <span
            className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background ${
              isWsConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
            }`}
          />
        </div>
        <div>
          <h1 className="font-bold text-base sm:text-lg tracking-tight leading-tight">
            Tuya RTSP Bridge
          </h1>
          <p className="text-[11px] text-muted-foreground font-mono leading-none">
            {isWsConnected ? "Realtime channel connected" : "Reconnecting events…"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Chip
          size="sm"
          variant="soft"
          color={onlineCount > 0 ? "success" : "default"}
          className="hidden sm:inline-flex text-xs font-medium"
        >
          <Radio className="size-3 mr-1 inline-block" />
          {onlineCount} / {totalCount} Online
        </Chip>

        <Button
          size="sm"
          variant="secondary"
          onPress={onRefreshClick}
          isDisabled={isRefreshing}
          className="text-xs font-medium"
        >
          <RefreshCw
            className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="size-4 text-amber-400" />
          ) : (
            <Moon className="size-4 text-foreground/80" />
          )}
        </Button>

        {isLoggedIn ? (
          <Dropdown>
            <Dropdown.Trigger>
              <Button
                isIconOnly
                variant="ghost"
                className="rounded-full size-8 p-0 min-w-8"
                aria-label="User Menu"
              >
                <Avatar size="sm" className="size-8 text-xs font-bold bg-primary text-primary-foreground">
                  <Avatar.Fallback>{userInitials}</Avatar.Fallback>
                </Avatar>
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end" className="min-w-60">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "add") onAddClick();
                  if (key === "logout") onLogoutClick();
                }}
              >
                <Dropdown.Item id="user-info" textValue={userDisplay}>
                  <Label>Signed in as</Label>
                  <Description>{userDisplay}</Description>
                </Dropdown.Item>
                <Dropdown.Item id="region" textValue="Region">
                  <Globe className="size-3.5 mr-2 inline" />
                  <Label>Region: {authState?.region?.toUpperCase() || "US"}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="add" textValue="Add profile">
                  <Plus className="size-3.5 mr-2 inline text-primary" />
                  <Label>Add profile</Label>
                </Dropdown.Item>
                <Dropdown.Item id="logout" textValue="Sign Out" variant="danger">
                  <LogOut className="size-3.5 mr-2 inline text-danger" />
                  <Label>Sign Out</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : null}
      </div>
    </header>
  );
};
