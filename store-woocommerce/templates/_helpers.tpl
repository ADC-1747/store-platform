{{/*
Expand the name of the chart.
*/}}
{{- define "store-woocommerce.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "store-woocommerce.fullname" -}}
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
{{- define "store-woocommerce.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "store-woocommerce.labels" -}}
helm.sh/chart: {{ include "store-woocommerce.chart" . }}
{{ include "store-woocommerce.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "store-woocommerce.selectorLabels" -}}
app.kubernetes.io/name: {{ include "store-woocommerce.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Selector labels for WordPress
*/}}
{{- define "store-woocommerce.selectorLabelsWordpress" -}}
{{ include "store-woocommerce.selectorLabels" . }}
app.kubernetes.io/component: wordpress
{{- end }}

{{/*
Selector labels for MariaDB
*/}}
{{- define "store-woocommerce.selectorLabelsMariadb" -}}
{{ include "store-woocommerce.selectorLabels" . }}
app.kubernetes.io/component: mariadb
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "store-woocommerce.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "store-woocommerce.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Extract domain from ingress host or store.domain for admin email
*/}}
{{- define "store-woocommerce.adminEmailDomain" -}}
{{- $host := "" }}
{{- if .Values.ingress.hosts }}
{{- $host = (index .Values.ingress.hosts 0).host }}
{{- else if .Values.store.domain }}
{{- $host = .Values.store.domain }}
{{- else }}
{{- $host = printf "%s.127.0.0.1.nip.io" .Release.Name }}
{{- end }}
{{- $domainParts := splitList "." $host }}
{{- $domainLen := len $domainParts }}
{{- if gt $domainLen 1 }}
{{- $lastTwo := last $domainParts }}
{{- join "." $lastTwo }}
{{- else }}
{{- "example.com" }}
{{- end }}
{{- end }}

{{/*
Generate admin email from store domain or use provided email
*/}}
{{- define "store-woocommerce.adminEmail" -}}
{{- if and .Values.admin .Values.admin.email }}
{{- .Values.admin.email }}
{{- else }}
{{- $domain := include "store-woocommerce.adminEmailDomain" . }}
{{- printf "admin@%s" $domain }}
{{- end }}
{{- end }}

{{/*
Get the info of the secret to use for MariaDB
*/}}
{{- define "store-woocommerce.mariadbSecretName" -}}
{{- if .Values.mariadb.auth.existingSecret -}}
{{- .Values.mariadb.auth.existingSecret -}}
{{- else -}}
{{- include "store-woocommerce.fullname" . -}}-mariadb-secret
{{- end -}}
{{- end -}}
