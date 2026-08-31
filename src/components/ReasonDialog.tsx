import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/primitives'

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  required,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  label: string
  placeholder?: string
  required?: boolean
  confirmLabel: string
  destructive?: boolean
  loading?: boolean
  onConfirm: (reason: string) => void | Promise<void>
}) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setText('')
      setTouched(false)
    }
  }, [open])

  const invalid = !!required && text.trim().length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => {
              setTouched(true)
              if (invalid) return
              void onConfirm(text.trim())
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field
        label={label}
        htmlFor="reason-dialog"
        required={required}
        error={touched && invalid ? 'This is required.' : undefined}
      >
        <Textarea
          id="reason-dialog"
          rows={3}
          autoFocus
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
    </Dialog>
  )
}
