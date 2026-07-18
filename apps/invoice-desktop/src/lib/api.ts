import { invoke } from "@tauri-apps/api/core";

export class ApiError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RustErrorShape = {
  kind: string;
  message?: string;
  status?: number;
};

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (typeof e === "object" && e !== null && "kind" in e) {
      const err = e as RustErrorShape;
      throw new ApiError(err.kind, err.message ?? err.kind);
    }
    throw new ApiError(
      "Unknown",
      typeof e === "string" ? e : JSON.stringify(e),
    );
  }
}

export type UserProfile = {
  password: string;
  username: string;
  authorities: {
    authority: string;
  }[];
  accountNonExpired: boolean;
  accountNonLocked: boolean;
  credentialsNonExpired: boolean;
  enabled: boolean;
  id: string;
  type: 2;
  groupId: string;
  groupIds: string;
  tinInfoTT86: {
    mst: string;
    mstUTien: string;
    dsMst: string[];
    cccd: boolean;
    groupIds: string;
    doiUng: boolean;
  };
  tcqt: string;
  name: string;
  capCqt: number;
  capUser: number;
  roleIds: string[];
  cdanh: string | null;
  domain: string | null;
  cbo: string;
  fullName: string | null;
  password_expire: string;
  expired: number;
};

export const api = {
  // login: (username: string, password: string) =>
  //   call<LoginResponse>("login", {
  //     payload: { username, password },
  //   }),
};
