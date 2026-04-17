# Smart Agriculture Monitor — PowerShell CORS Proxy Server
# Lightweight proxy that forwards /proxy/* requests to the cloud platform
# and serves static files for the web app.
# 
# Usage: powershell -ExecutionPolicy Bypass -File proxy-server.ps1
# Access: http://localhost:3000

$port = 3000
$staticDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultTargetBase = "http://www.0531yun.com"

# MIME type mapping
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Port $port may require admin. Trying localhost only..." -ForegroundColor Yellow
    $listener.Close()
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   🌾 智慧农业监测平台 — 代理服务器            ║" -ForegroundColor Cyan
Write-Host "  ║                                              ║" -ForegroundColor Cyan
Write-Host "  ║   本地访问: http://localhost:$port             ║" -ForegroundColor Cyan
Write-Host "  ║   API代理:  /proxy/api/* → www.0531yun.com   ║" -ForegroundColor Cyan
Write-Host "  ║                                              ║" -ForegroundColor Cyan
Write-Host "  ║   按 Ctrl+C 停止服务器                        ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $path = $request.Url.LocalPath

        # Add CORS headers
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "authorization, content-type, x-target-base")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # Proxy API requests
        if ($path.StartsWith("/proxy/")) {
            $apiPath = $path.Substring(6)  # Remove /proxy
            $targetBase = $request.Headers["x-target-base"]
            if (-not $targetBase -or ($targetBase -notmatch '^https?://')) {
                $targetBase = $defaultTargetBase
            }
            if (-not $targetBase.EndsWith("/")) {
                $targetBase += "/"
            }
            $targetUrl = [System.Uri]::new([System.Uri]$targetBase, $apiPath.TrimStart('/')).AbsoluteUri
            if ($request.Url.Query) {
                $targetUrl += $request.Url.Query
            }

            Write-Host "  [PROXY] $($request.HttpMethod) $apiPath" -ForegroundColor Cyan

            try {
                $webRequest = [System.Net.HttpWebRequest]::Create($targetUrl)
                $webRequest.Method = $request.HttpMethod
                $webRequest.Timeout = 15000
                $webRequest.UserAgent = "AgriMonitor/1.0"

                # Forward authorization header
                $auth = $request.Headers["authorization"]
                if ($auth) {
                    $webRequest.Headers.Add("authorization", $auth)
                }

                $webResponse = $webRequest.GetResponse()
                $stream = $webResponse.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $stream.Close()
                $webResponse.Close()

                $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bodyBytes.Length
                $response.StatusCode = 200
                $response.OutputStream.Write($bodyBytes, 0, $bodyBytes.Length)
            } catch [System.Net.WebException] {
                $errResponse = $_.Exception.Response
                if ($errResponse) {
                    $errStream = $errResponse.GetResponseStream()
                    $errReader = New-Object System.IO.StreamReader($errStream)
                    $errBody = $errReader.ReadToEnd()
                    $errReader.Close()
                    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($errBody)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.StatusCode = [int]$errResponse.StatusCode
                } else {
                    $errMsg = "{`"code`":-1,`"message`":`"Proxy error: $($_.Exception.Message)`"}"
                    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($errMsg)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.StatusCode = 502
                }
                $response.ContentLength64 = $bodyBytes.Length
                $response.OutputStream.Write($bodyBytes, 0, $bodyBytes.Length)
                Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        # Serve static files
        else {
            if ($path -eq "/") { $path = "/index.html" }
            $filePath = Join-Path $staticDir ($path.TrimStart('/').Replace('/', '\'))
            $filePath = [System.IO.Path]::GetFullPath($filePath)

            # Security check
            if (-not $filePath.StartsWith($staticDir)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                
                $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = $fileBytes.Length
                $response.StatusCode = 200
                $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
                
                $shortPath = $path
                if ($shortPath.Length -gt 40) { $shortPath = "..." + $shortPath.Substring($shortPath.Length - 37) }
                Write-Host "  [STATIC] $shortPath" -ForegroundColor DarkGray
            } else {
                $response.StatusCode = 404
                $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
                $response.ContentLength64 = $msg.Length
                $response.OutputStream.Write($msg, 0, $msg.Length)
                Write-Host "  [404] $path" -ForegroundColor Yellow
            }
        }

        $response.Close()
    } catch {
        if ($_.Exception.Message -notlike "*thread exit*" -and $_.Exception.Message -notlike "*listener*") {
            Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
