export interface NativeLoginStatus {
  state: "signed-in" | "sign-in-required" | "unavailable";
  checkedAt: string;
}

export interface NativeLoginService {
  status(): Promise<NativeLoginStatus>;
}
