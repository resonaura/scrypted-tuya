import { Avatar, Description, Dropdown, Label } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, LogOut, Moon, Plus, RefreshCw, Sun } from "lucide-react";
import React from "react";
import type { AuthState } from "../types/index.js";
import { Button } from "./ui/index.js";

interface NavbarProps {
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
  isWsConnected: _isWsConnected,
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
    <>
      <header className="fixed h-15 box-border top-0 z-40 w-full backdrop-blur-xl bg-background/80 px-4 sm:px-8 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <img src="/icon.png" alt="Tuya Bridge" className="size-7" />
          <div>
            <h1 className="font-bold text-base sm:text-lg tracking-tight leading-tight">
              Tuya RTSP Bridge
            </h1>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            size="sm"
            onPress={onAddClick}
            className="text-xs font-medium"
            variant="accent-soft"
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Add profile</span>
          </Button>

          <Button
            size="sm"
            onPress={onRefreshClick}
            isDisabled={isRefreshing}
            className="text-xs font-medium"
            variant="default-soft"
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                className="flex size-4 items-center justify-center"
              >
                {theme === "dark" ? (
                  <Moon className="size-4" />
                ) : (
                  <Sun className="size-4" />
                )}
              </motion.span>
            </AnimatePresence>
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
                  <Avatar
                    size="sm"
                    className="size-8 text-xs font-bold bg-primary text-primary-foreground"
                  >
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
                  <Dropdown.Item
                    id="user-info"
                    className="opacity-50"
                    textValue={userDisplay}
                  >
                    <Label>Signed in as</Label>
                    <Description>{userDisplay}</Description>
                  </Dropdown.Item>
                  <Dropdown.Item id="region" textValue="Region">
                    <Globe className="size-3.5 inline" />
                    <Label>
                      Region: {authState?.region?.toUpperCase() || "US"}
                    </Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="add" textValue="Add profile">
                    <Plus className="size-3.5 inline text-primary" />
                    <Label>Add profile</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="logout"
                    textValue="Sign Out"
                    variant="danger"
                  >
                    <LogOut className="size-3.5 inline text-danger" />
                    <Label>Sign Out</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          ) : null}
        </div>
      </header>
      <div className="h-10" />
    </>
  );
};
