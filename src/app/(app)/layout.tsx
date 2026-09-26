import { requireUser } from "@/lib/auth";
import { logout } from "../(auth)/actions";
import Nav from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen md:flex">
      <aside
        className="md:w-56 md:min-h-screen md:border-r border-b md:border-b-0 flex md:flex-col gap-2 p-3 md:p-4"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="font-semibold px-2 py-1 md:mb-3 whitespace-nowrap">Warehouse</div>
        <Nav />
        <div className="md:mt-auto ml-auto md:ml-0 flex md:flex-col items-center md:items-stretch gap-2">
          <div className="hidden md:block px-2 text-xs muted truncate" title={user.email}>
            {user.name}
            <br />
            {user.email}
          </div>
          <form action={logout}>
            <button className="btn btn-ghost btn-sm w-full justify-center">Log out</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-4 py-6 md:px-8 max-w-6xl">{children}</main>
    </div>
  );
}
