{{/*
Expand the name of the chart.
*/}}
{{- define "store-medusa.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "store-medusa.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "store-medusa.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "store-medusa.labels" -}}
helm.sh/chart: {{ include "store-medusa.chart" . }}
{{ include "store-medusa.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "store-medusa.selectorLabels" -}}
app.kubernetes.io/name: {{ include "store-medusa.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "store-medusa.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "store-medusa.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Extract domain from store.domain for admin email
Example: "store.example.com" -> "example.com"
*/}}
{{- define "store-medusa.adminEmailDomain" -}}
{{- if .Values.admin.email }}
{{- /* If admin.email is explicitly set, extract domain from it */}}
{{- $parts := splitList "@" .Values.admin.email }}
{{- if eq (len $parts) 2 }}
{{- index $parts 1 }}
{{- else }}
{{- /* Fallback: extract from store.domain */}}
{{- $domainParts := splitList "." .Values.store.domain }}
{{- $domainLen := len $domainParts }}
{{- if ge $domainLen 2 }}
{{- /* Get last 2 parts: manually construct from last 2 indices */}}
{{- $secondLast := index $domainParts (sub $domainLen 2) }}
{{- $last := index $domainParts (sub $domainLen 1) }}
{{- printf "%s.%s" $secondLast $last }}
{{- else }}
{{- "example.com" }}
{{- end }}
{{- end }}
{{- else }}
{{- /* Extract domain from store.domain */}}
{{- $domainParts := splitList "." .Values.store.domain }}
{{- $domainLen := len $domainParts }}
{{- if ge $domainLen 2 }}
{{- /* Get last 2 parts: manually construct from last 2 indices */}}
{{- $secondLast := index $domainParts (sub $domainLen 2) }}
{{- $last := index $domainParts (sub $domainLen 1) }}
{{- printf "%s.%s" $secondLast $last }}
{{- else }}
{{- "example.com" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate admin email from store domain or use provided email
*/}}
{{- define "store-medusa.adminEmail" -}}
{{- if .Values.admin.email }}
{{- .Values.admin.email }}
{{- else }}
{{- $domain := include "store-medusa.adminEmailDomain" . }}
{{- printf "admin@%s" $domain }}
{{- end }}
{{- end }}

{{/*
Get storefront host from ingress hosts or construct from store.domain
*/}}
{{- define "store-medusa.storefrontHost" -}}
{{- $host := "" }}
{{- if and .Values.ingress .Values.ingress.hosts }}
{{- range .Values.ingress.hosts }}
{{- if eq .name "storefront" }}
{{- $host = .host }}
{{- end }}
{{- end }}
{{- end }}
{{- if not $host }}
{{- if .Values.store.domain }}
{{- $host = .Values.store.domain }}
{{- else }}
{{- $host = printf "%s.127.0.0.1.nip.io" .Release.Name }}
{{- end }}
{{- end }}
{{- $host }}
{{- end }}

{{/*
Get backend API host from ingress hosts or construct from store.domain
*/}}
{{- define "store-medusa.backendHost" -}}
{{- $host := "" }}
{{- if and .Values.ingress .Values.ingress.hosts }}
{{- range .Values.ingress.hosts }}
{{- if eq .name "backend" }}
{{- $host = .host }}
{{- end }}
{{- end }}
{{- end }}
{{- if not $host }}
{{- if .Values.store.domain }}
{{- /* Extract base domain: replace first part with {release-name}-api */}}
{{- /* Use regex to replace everything up to the first dot with {release-name}-api */}}
{{- $host = regexReplaceAll "^[^.]+" .Values.store.domain (printf "%s-api" .Release.Name) }}
{{- else }}
{{- $host = printf "%s-api.127.0.0.1.nip.io" .Release.Name }}
{{- end }}
{{- end }}
{{- $host }}
{{- end }}

{{/*
Get the name of the secret to use for PostgreSQL
*/}}
{{- define "store-medusa.postgresSecretName" -}}
{{- if .Values.postgres.existingSecret -}}
{{- .Values.postgres.existingSecret -}}
{{- else -}}
{{- include "store-medusa.fullname" . -}}-postgres-secret
{{- end -}}
{{- end -}}

{{/*
Get the name of the secret to use for Medusa security (JWT_SECRET, COOKIE_SECRET)
*/}}
{{- define "store-medusa.medusaSecretName" -}}
{{- if .Values.security.existingSecret -}}
{{- .Values.security.existingSecret -}}
{{- else -}}
{{- include "store-medusa.fullname" . -}}-medusa-secret
{{- end -}}
{{- end -}}
