import { useState, type ChangeEvent, type FormEvent } from 'react'
import { FileUp } from 'lucide-react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { suggestCategoryId } from './categorySuggestions'
import type { Category } from '../../types'
import { formatCurrency } from '../../utils/finance'
import { parseStatementText, type StatementRow } from './statementParser'
import type { StatementImportResult, StatementPreviewRow } from '../../lib/api'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface StatementImportDialogProps {
  currency: string
  categories: Category[]
  onClose: () => void
  onPreview: (rows: StatementRow[]) => Promise<StatementPreviewRow[]>
  onImport: (rows: StatementRow[]) => Promise<StatementImportResult>
}

function extractLineText(items: unknown[]) {
  const lines = new Map<number, Array<{ x: number; text: string }>>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item) || !('transform' in item)) continue
    const text = item.str
    const transform = item.transform
    if (typeof text !== 'string' || !text.trim() || !Array.isArray(transform)) continue
    const x = Number(transform[4] ?? 0)
    const y = Math.round(Number(transform[5] ?? 0))
    const line = lines.get(y) ?? []
    line.push({ x, text: text.trim() })
    lines.set(y, line)
  }
  return [...lines.entries()]
    .sort(([firstY], [secondY]) => secondY - firstY)
    .map(([, lineItems]) => lineItems.sort((first, second) => first.x - second.x).map((item) => item.text).join(' '))
    .join('\n')
}

interface ReviewRow extends StatementRow {
  isDuplicate: boolean
  autoCategorized: boolean
}

export function StatementImportDialog({ currency, categories, onClose, onPreview, onImport }: StatementImportDialogProps) {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<StatementImportResult | null>(null)

  const readPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFilename(file.name)
    setRows([])
    setError('')
    setStatus('')
    setResult(null)
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 15 * 1024 * 1024) {
      setError('Choose a PDF statement smaller than 15 MB.')
      return
    }

    setBusy(true)
    try {
      const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      const pageLines: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        pageLines.push(extractLineText(content.items))
      }
      const parsed = parseStatementText(pageLines.join('\n'))
      if (parsed.length === 0) {
        setError('No selectable transaction rows were found. Scanned/image-only PDFs are not supported; try a text-based PDF statement.')
      } else {
        const preview = await onPreview(parsed)
        setRows(preview)
        const newCount = preview.filter((row) => !row.isDuplicate).length
        setStatus(`${newCount} new transactions; ${preview.length - newCount} duplicates. Review categories before importing.`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? `Could not prepare this import: ${caught.message}` : 'Could not prepare this import.')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const updateRow = (index: number, update: Partial<ReviewRow>) => {
    setResult(null)
    setStatus('')
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row))
  }

  const refreshPreview = async () => {
    if (rows.length === 0) return
    setBusy(true)
    setError('')
    try {
      const previewInput = rows.map((row): StatementRow => ({
        transactionDate: row.transactionDate,
        description: row.description,
        amount: row.amount,
        type: row.type,
        categoryId: row.autoCategorized ? '' : row.categoryId,
      }))
      const preview = await onPreview(previewInput)
      setRows(preview)
      const newCount = preview.filter((row) => !row.isDuplicate).length
      setStatus(`${newCount} new transactions; ${preview.length - newCount} duplicates. Review categories before importing.`)
    } catch (caught) {
      setError(caught instanceof Error ? `Could not refresh the import preview: ${caught.message}` : 'Could not refresh the import preview.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rows.length === 0) return
    if (rows.some((row) => !row.transactionDate || !Number.isFinite(row.amount) || row.amount <= 0)) {
      setError('Choose a valid date and amount for every row.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const imported = await onImport(rows)
      setResult(imported)
      setStatus('Import complete.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import these transactions.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="dialog statement-dialog" role="dialog" aria-modal="true" aria-labelledby="statement-dialog-title">
        <div className="panel-header"><div><p className="eyebrow">Private in-browser processing</p><h3 id="statement-dialog-title">Import bank statement</h3></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button></div>
        <p className="statement-note">The PDF is read in this browser and is not uploaded. Review every detected row before it is saved to your workspace.</p>
        <label className="statement-file-picker"><FileUp size={19} aria-hidden="true" /><span>{busy && !rows.length ? 'Reading statement…' : busy ? 'Checking or importing statement…' : filename || 'Choose a PDF statement'}</span><input type="file" accept="application/pdf,.pdf" onChange={readPdf} disabled={busy} /></label>
        {error && <p className="auth-message error" role="alert">{error}</p>}
        {categories.length === 0 && <p className="auth-message error" role="status">No categories are available in this workspace. Apply <code>supabase/migrations/20261009160000_seed_existing_workspace_categories.sql</code> in the Supabase SQL Editor, then reload the app.</p>}
        {status && <p className="statement-status" role="status">{status}</p>}
        {result && <div className="statement-status" role="status">
          <strong>Import complete</strong>
          <p>{result.new} transactions imported; {result.duplicates} duplicates skipped.</p>
          <p>{result.categorized} categorized; {result.uncategorized} uncategorized.</p>
        </div>}
        {rows.length > 0 && <form className="statement-review" onSubmit={submit}>
          <div className="statement-review-heading"><h4>Review transactions</h4><span>{rows.filter((row) => !row.isDuplicate).length} new · {rows.filter((row) => row.isDuplicate).length} duplicates · {currency}</span></div>
          <div className="table-scroll statement-table-wrap"><table className="data-table statement-table"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th>Category</th><th>Status</th></tr></thead><tbody>{rows.map((row, index) => {
            const rowCategories = categories.filter((category) => category.type === row.type || category.type === 'both')
            return <tr key={`${row.transactionDate}-${row.description}-${index}`}>
              <td><input aria-label={`Date for row ${index + 1}`} type="date" value={row.transactionDate} onChange={(event) => updateRow(index, { transactionDate: event.target.value })} onBlur={refreshPreview} disabled={busy} required /></td>
              <td><input aria-label={`Description for row ${index + 1}`} value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} onBlur={refreshPreview} maxLength={240} disabled={busy} /></td>
              <td><select aria-label={`Type for row ${index + 1}`} value={row.type} onChange={(event) => { const type = event.target.value as StatementRow['type']; updateRow(index, { type, categoryId: suggestCategoryId(row.description, type, categories) ?? '', autoCategorized: true }) }} onBlur={refreshPreview} disabled={busy}><option value="expense">Expense</option><option value="income">Income</option></select></td>
              <td><label className="statement-amount"><span>{formatCurrency(row.amount, currency)}</span><input aria-label={`Amount for row ${index + 1}`} type="number" min="0.01" step="0.01" value={row.amount} onChange={(event) => updateRow(index, { amount: Number(event.target.value) })} onBlur={refreshPreview} required disabled={busy} /></label></td>
              <td><select aria-label={`Category for row ${index + 1}`} value={row.categoryId} onChange={(event) => updateRow(index, { categoryId: event.target.value, autoCategorized: false })} onBlur={refreshPreview} disabled={busy}><option value="">Uncategorized</option>{rowCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{rowCategories.length === 0 && <small>No {row.type} categories available. Seed categories for this workspace to enable selection.</small>}{row.autoCategorized && <small>Auto-assigned</small>}</td>
              <td>{row.isDuplicate ? 'Duplicate' : 'New'}</td>
            </tr>
          })}</tbody></table></div>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Close</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Importing…' : `Import ${rows.filter((row) => !row.isDuplicate).length} new transactions`}</button></div>
        </form>}
      </section>
    </div>
  )
}
