import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("fetches the dashboard through the LaMaison base route", async () => {
  vi.stubEnv("BASE_URL", "/ledashboard/");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchDashboard } = await import("../lib/api");

  await fetchDashboard();

  expect(fetchMock).toHaveBeenCalledWith(
    "/ledashboard/api/dashboard",
    { signal: undefined },
  );
});
