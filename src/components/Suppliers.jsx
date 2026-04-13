import GoogleDriveBrowser from '../components/GoogleDrivePicker'

export default function GoogleDrive() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Google Drive</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Browse, upload and manage your Google Drive files directly from the CRM
        </p>
      </div>
      <GoogleDriveBrowser />
    </div>
  )
}
