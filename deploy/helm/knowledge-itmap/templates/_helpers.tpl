{{- define "knowledge-itmap.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "knowledge-itmap.fullname" -}}
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

{{- define "knowledge-itmap.mcpFullname" -}}
{{- printf "%s-mcp" (include "knowledge-itmap.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "knowledge-itmap.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "knowledge-itmap.labels" -}}
helm.sh/chart: {{ include "knowledge-itmap.chart" . }}
{{ include "knowledge-itmap.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "knowledge-itmap.selectorLabels" -}}
app.kubernetes.io/name: {{ include "knowledge-itmap.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ui
{{- end }}

{{- define "knowledge-itmap.mcpSelectorLabels" -}}
app.kubernetes.io/name: {{ include "knowledge-itmap.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: mcp
{{- end }}

{{- define "knowledge-itmap.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "knowledge-itmap.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "knowledge-itmap.mcpUpstream" -}}
http://{{ include "knowledge-itmap.mcpFullname" . }}:{{ .Values.mcpService.port }}
{{- end }}
