import React from "react";
import { createContext, useContext, type ReactNode } from "react";

export type Profile = {
  accountNonExpired: boolean;
  accountNonLocked: boolean;
  authorities: {
    authority: string;
  }[];
  capCqt: number;
  capUser: number;
  cbo: string;
  cdanh: null;
  credentialsNonExpired: boolean;
  domain: null;
  enabled: boolean;
  expired: number;
  fullName: null;
  groupId: string;
  groupIds: string;
  id: string;
  name: string;
  password: string;
  password_expire: string;
  roleIds: string[];
  tcqt: string;
  tinInfoTT86: {
    cccd: boolean;
    doiUng: boolean;
    dsMst: string[];
    groupIds: string;
    mst: string;
    mstUTien: string;
  };
  type: number;
  username: string;
};

// type Setting = {};

type AuthContextValue = {
  profile: Profile;
  //   setting: Setting;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined)
    throw new Error("useAuth must be used within a AuthProvider");
  return context;
}

export function AuthProvider({
  children,
  profile,
}: {
  children: ReactNode;
  profile: Profile;
}) {
  const [state, setState] = React.useState<AuthContextValue | null>(null);

  React.useEffect(() => {
    setState({ profile });
  }, []);

  const contextValue = React.useMemo<AuthContextValue | null>(
    () => state,
    [state],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}
