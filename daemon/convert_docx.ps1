param (
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$word = $null
$doc = $null

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    # Open document read-only, no repair dialogs
    $doc = $word.Documents.Open($InputPath, $false, $true)
    
    # 17 = wdFormatPDF
    $doc.SaveAs2($OutputPath, 17)
    $doc.Close($false)
    $doc = $null

    $word.Quit()
    $word = $null

    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    if (Test-Path $OutputPath) {
        Write-Output "SUCCESS: Converted to $OutputPath"
        exit 0
    } else {
        Write-Error "Conversion finished but output file not found"
        exit 1
    }
} catch {
    Write-Error $_.Exception.Message
    if ($doc) { try { $doc.Close($false) } catch {} }
    if ($word) { try { $word.Quit() } catch {} }
    exit 1
}
