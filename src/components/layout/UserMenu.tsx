import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, ImageUp, KeyRound, LogOut } from 'lucide-react'
import { useAuth } from '@/providers/AuthProvider'
import { useEmployees } from '@/hooks/useLeaveData'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import { Avatar } from '@/components/Avatar'
import { ProfilePhotoDialog } from '@/components/ProfilePhotoDialog'

const ROLE_LABEL: Record<string, string> = {
  employee: 'Employee',
  supervisor: 'Supervisor',
  hr_admin: 'HR administrator',
  system_admin: 'System administrator',
}

/**
 * The account menu in the header. Sign out used to be a bare icon with no
 * label, sitting next to nothing else — one unlabelled button for the single
 * most destructive action in the bar.
 */
export function UserMenu() {
  const { employee, signOut } = useAuth()
  const { data: employees = [] } = useEmployees()
  const [changing, setChanging] = useState(false)
  const [changingPhoto, setChangingPhoto] = useState(false)

  if (!employee) return null

  const supervisor = employee.supervisor_id
    ? employees.find((e) => e.id === employee.supervisor_id)
    : undefined

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label="Account menu"
          >
            <Avatar
              fullName={employee.full_name}
              avatarPath={employee.avatar_path}
              avatarEmoji={employee.avatar_emoji}
              size="md"
              className="h-8 w-8 bg-white/15 text-[11px] text-white ring-1 ring-inset ring-white/25"
            />
            <span className="hidden leading-tight sm:block">
              <span className="block max-w-[11rem] truncate text-xs font-medium text-white">
                {employee.full_name}
              </span>
              <span className="block text-[11px] text-white/70">
                {ROLE_LABEL[employee.role] ?? employee.role}
              </span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-white/70 sm:block" aria-hidden />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-slate-900">
                {employee.full_name}
              </p>
              <p className="truncate text-xs text-slate-500">{employee.email}</p>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Role</dt>
                  <dd className="font-medium text-slate-800">
                    {ROLE_LABEL[employee.role] ?? employee.role}
                  </dd>
                </div>
                {employee.department ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Department</dt>
                    <dd className="truncate font-medium text-slate-800">{employee.department}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">Approver</dt>
                  <dd className="min-w-0 truncate text-right font-medium text-slate-800">
                    {supervisor ? supervisor.full_name : 'HR (no supervisor set)'}
                  </dd>
                </div>
              </dl>
            </div>

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-50"
              onSelect={() => setChangingPhoto(true)}
            >
              <ImageUp className="h-4 w-4 text-slate-400" />
              {employee.avatar_path || employee.avatar_emoji ? 'Change your avatar' : 'Add a photo or emoji'}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-50"
              onSelect={() => setChanging(true)}
            >
              <KeyRound className="h-4 w-4 text-slate-400" />
              Change password
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="h-px bg-slate-100" />

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-chaiDarkRed outline-none data-[highlighted]:bg-chaiDarkRed/5"
              onSelect={() => void signOut()}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
      <ProfilePhotoDialog
        employee={employee}
        open={changingPhoto}
        onOpenChange={setChangingPhoto}
      />
    </>
  )
}


