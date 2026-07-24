import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import logo from "@/assets/logo.png";
import { useAuth } from "@/contexts/auth-context";
import { useForm } from "@tanstack/react-form";
import { invoke } from "@tauri-apps/api/core";
import { Spinner } from "./ui/spinner";
import { useNavigate } from "@tanstack/react-router";

export function NavUser() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const auth = useAuth();

  const form = useForm({
    onSubmit: async () => {
      try {
        await invoke("logout");
        navigate({ to: "/" });
      } catch (e) {
        console.log(e);
      }
    },
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                />
              }
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={logo} alt={auth?.profile.username ?? ""} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {auth?.profile.name ?? ""}
                </span>
                <span className="truncate text-xs">
                  {auth?.profile.username ?? ""}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage
                        src={logo}
                        alt={auth?.profile.username ?? ""}
                      />
                      <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {auth?.profile.name ?? ""}
                      </span>
                      <span className="truncate text-xs">
                        {auth?.profile.username ?? ""}
                      </span>
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <Sparkles />
                  Upgrade to Pro
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <BadgeCheck />
                  Account
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <CreditCard />
                  Billing
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Bell />
                  Notifications
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <AlertDialogTrigger render={<DropdownMenuItem />}>
                  <LogOut />
                  Log out
                </AlertDialogTrigger>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialogContent
            render={
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  form.handleSubmit();
                }}
              />
            }
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Bạn có hoàn toàn chắc chắn không?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Hành động này không thể hoàn tác. Việc này sẽ xóa toàn bộ dữ
                liệu của bạn khỏi máy tính của bạn.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
              children={([canSubmit, isSubmitting]) => (
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={!canSubmit}>
                    Huỷ
                  </AlertDialogCancel>
                  <AlertDialogAction type="submit" disabled={!canSubmit}>
                    {isSubmitting && <Spinner data-icon="inline-start" />}
                    Đăng xuất
                  </AlertDialogAction>
                </AlertDialogFooter>
              )}
            />
          </AlertDialogContent>
        </AlertDialog>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
