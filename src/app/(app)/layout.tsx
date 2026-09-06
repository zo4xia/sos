"use client";

/**
 * (app) 路由组布局：登录守卫 + AppShell 门面壳体
 */
import "tdesign-react/es/_util/react-19-adapter.js";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loading } from "tdesign-react";
import AppShell from "@/lib/layout/AppShell";
import { useAuthStore } from "@/lib/stores/useAuthStore";
import { useMounted } from "@/lib/hooks/useMounted";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const mounted = useMounted();

  // 登录守卫：未登录跳登录大门（外部系统跳转，不涉及 setState）
  useEffect(() => {
    if (token) return;
    const stored = typeof window !== "undefined" ? localStorage.getItem("cxq_token") : null;
    if (!stored) {
      router.replace("/login");
    }
  }, [token, router]);

  if (!mounted) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Loading size="large" text="正在进入工作台..." />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
