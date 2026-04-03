import React, { useState, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { 
  Upload, 
  Search, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  FileText, 
  X,
  Download,
  Filter,
  Languages,
  Loader2,
  Info,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc' | null;
};

type ColumnFormat = 'number' | 'percentage' | 'currency' | 'text';

export default function App() {
  const [data, setData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [translatedHeaders, setTranslatedHeaders] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [fileName, setFileName] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: '', direction: null });
  const [isDragging, setIsDragging] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);

  const getColumnFormat = useCallback((header: string): ColumnFormat => {
    const h = (translatedHeaders[header] || header).toLowerCase();
    
    // 1. Percentage: Rate, Retention, Ratio, etc.
    if (h.includes('率') || h.includes('留存') || h.includes('rate') || h.includes('retention') || h.includes('percent') || h.includes('ratio')) {
      return 'percentage';
    }
    
    // 2. Strong Currency Keywords: Revenue, Amount, Price, Cost, etc.
    // These should take priority even if "total" or "count" is present (e.g., "Total Revenue")
    if (h.includes('营收') || h.includes('金额') || h.includes('价格') || h.includes('费用') || 
        h.includes('revenue') || h.includes('price') || h.includes('cost') || h.includes('usd') || h.includes('money')) {
      return 'currency';
    }

    // 3. Number (Count/Total): If it contains "数", "量", "次数", "count", "total"
    if (h.includes('数') || h.includes('量') || h.includes('次数') || h.includes('count') || h.includes('total') || h.includes('sum') || h.includes('number') || h.includes('总') || h.includes('累计')) {
      return 'number';
    }

    // 4. Weak/General Currency Keywords: Paid, Amount, etc.
    if (h.includes('付费') || h.includes('钱') || h.includes('paid') || h.includes('amount')) {
      return 'currency';
    }
    
    return 'text';
  }, [translatedHeaders]);

  const formatValue = (value: any, format: ColumnFormat) => {
    if (value === null || value === undefined || value === '') return '-';
    
    const num = parseFloat(value);
    if (isNaN(num)) return value;

    switch (format) {
      case 'percentage':
        // If the value is already a decimal (e.g. 0.15), multiply by 100. 
        // If it's already > 1 (e.g. 15), assume it's already a percentage value.
        // Heuristic: if max value in column is <= 1, it's likely a decimal. 
        // For simplicity, we'll just format as num% if it's already a percentage-like string, 
        // but usually CSVs have 0.85 for 85%.
        const displayNum = num <= 1 && num > 0 ? num * 100 : num;
        return `${displayNum.toFixed(2)}%`;
      
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num);
      
      case 'number':
        return new Intl.NumberFormat('en-US', {
          maximumFractionDigits: 2,
        }).format(num);
      
      default:
        // Try to format as number if it looks like one
        if (!isNaN(num) && String(value).length > 3) {
          return new Intl.NumberFormat('en-US').format(num);
        }
        return value;
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return;
    
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length > 0) {
          const rawHeaders = Object.keys(results.data[0]);
          setHeaders(rawHeaders);
          setData(results.data);
          setTranslatedHeaders({}); 
          setAnalysis(null);
        }
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        alert('解析 CSV 文件时出错，请检查文件格式。');
      }
    });
  }, []);

  const translateHeaders = async (currentHeaders: string[] = headers) => {
    if (currentHeaders.length === 0) return null;
    
    setIsTranslating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `你是一个专业的数据分析助手。请将以下 CSV 列头翻译成简洁的中文。
要求：
1. 每个翻译后的列头不超过 5 个汉字。
2. 保持专业性且易于理解。
3. 以 JSON 格式返回，格式为: {"原始列头": "翻译后的列头"}。

列头列表：
${currentHeaders.join(', ')}`,
        config: {
          responseMimeType: "application/json",
        }
      });

      const result = JSON.parse(response.text || '{}');
      setTranslatedHeaders(result);
      return result;
    } catch (error) {
      console.error('Translation error:', error);
      return null;
    } finally {
      setIsTranslating(false);
    }
  };

  const generateAnalysis = async (currentData: any[] = data, headerMapObj: Record<string, string> = translatedHeaders) => {
    if (currentData.length === 0) return;
    
    setIsAnalyzing(true);
    setShowAnalysis(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Check if there's ad-level data
      const hasAdData = Object.values(headerMapObj).some(h => h.includes('广告') || h.toLowerCase().includes('ad')) ||
                        headers.some(h => h.toLowerCase().includes('ad') || h.includes('广告'));

      // Prepare a concise version of the data for the AI
      const dataSample = currentData.slice(0, 50); 
      const dataString = JSON.stringify(dataSample);
      const headerMap = JSON.stringify(headerMapObj);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `你是一位专业的广告数据分析师。请基于提供的 CSV 数据，撰写一份客观、精炼的投放分析。

**输出准则：**
1. **去 AI 化**：严禁使用“之王”、“先锋”、“标兵”、“战役”等浮夸词汇或拟人化隐喻。
2. **专业叙事**：采用冷静、客观的分析语气，类似 Claude 的专业表达。
3. **结构清晰：**
   - 首先，用表格对比表现最优的 3 个广告系列（Campaign）。
   ${hasAdData ? '- 其次，识别并对比表现显著的 3 个具体广告（Ad），分析其素材或定向的差异。' : ''}
   - 接着，分点列出核心发现（量级、付费、转化、留存），每点仅限 1-2 句话，直接陈述事实与数据。
   - 最后，给出具体的预算调整建议。
4. **术语准确**：Campaign 统一翻译为“广告系列”，Ad 统一翻译为“广告”。

列头映射：${headerMap}

数据样本（前50行）：
${dataString}`,
      });

      setAnalysis(response.text || '未能生成分析报告。');
    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Automation Effect
  React.useEffect(() => {
    const autoProcess = async () => {
      if (data.length > 0 && headers.length > 0 && !analysis && !isAutoProcessing) {
        setIsAutoProcessing(true);
        const tHeaders = await translateHeaders(headers);
        if (tHeaders) {
          await generateAnalysis(data, tHeaders);
        }
        setIsAutoProcessing(false);
      }
    };
    autoProcess();
  }, [data, headers]);

  const exportProcessedCSV = () => {
    if (filteredAndSortedData.length === 0) return;

    // Prepare headers
    const csvHeaders = headers.map(h => translatedHeaders[h] || h);
    
    // Prepare rows
    const csvRows = filteredAndSortedData.map(row => 
      headers.map(header => {
        const format = getColumnFormat(header);
        const value = row[header];
        const formatted = formatValue(value, format);
        // Escape quotes for CSV
        return `"${String(formatted).replace(/"/g, '""')}"`;
      }).join(',')
    );

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `processed_${fileName || 'data'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportAnalysisMarkdown = () => {
    if (!analysis) return;
    const blob = new Blob([analysis], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `analysis_${fileName.replace('.csv', '') || 'report'}.md`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      handleFileUpload(file);
    } else {
      alert('请上传有效的 CSV 文件');
    }
  }, [handleFileUpload]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedData = useMemo(() => {
    let processed = [...data];

    // Filter
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      processed = processed.filter(row => 
        Object.values(row).some(val => 
          String(val).toLowerCase().includes(lowerSearch)
        )
      );
    }

    // Sort
    if (sortConfig.key && sortConfig.direction) {
      processed.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        
        if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return processed;
  }, [data, searchTerm, sortConfig]);

  const reset = () => {
    setData([]);
    setHeaders([]);
    setTranslatedHeaders({});
    setAnalysis(null);
    setFileName('');
    setSearchTerm('');
    setSortConfig({ key: '', direction: null });
    setIsAutoProcessing(false);
  };

  const summaryData = useMemo(() => {
    if (filteredAndSortedData.length === 0) return null;

    const summary: Record<string, any> = {};
    headers.forEach(header => {
      const format = getColumnFormat(header);
      const values = filteredAndSortedData
        .map(row => parseFloat(row[header]))
        .filter(val => !isNaN(val));

      if (values.length === 0) {
        summary[header] = null;
        return;
      }

      if (format === 'percentage') {
        // Average for percentages
        const sum = values.reduce((acc, val) => acc + val, 0);
        summary[header] = sum / values.length;
      } else if (format === 'number' || format === 'currency') {
        // Sum for numbers and currency
        summary[header] = values.reduce((acc, val) => acc + val, 0);
      } else {
        summary[header] = null;
      }
    });
    return summary;
  }, [filteredAndSortedData, headers, getColumnFormat]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">基于Appsflyer投放数据报告的智能分析系统</h1>
            <p className="text-slate-500 mt-1">上传 CSV 文件，即刻获取 AI 翻译、智能格式化与深度数据洞察。</p>
          </div>
          <div className="flex items-center gap-3">
            {data.length > 0 && (
              <>
                {(isTranslating || isAnalyzing) && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium animate-pulse">
                    <Loader2 size={14} className="animate-spin" />
                    AI 正在自动处理数据...
                  </div>
                )}
                <button 
                  onClick={reset}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600 transition-all shadow-sm"
                >
                  <X size={16} />
                  重置
                </button>
              </>
            )}
          </div>
        </header>

        {/* Upload Area */}
        {data.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "relative group border-2 border-dashed rounded-2xl p-12 transition-all duration-300 flex flex-col items-center justify-center text-center",
              isDragging ? "border-blue-500 bg-blue-50/50" : "border-slate-200 bg-white hover:border-slate-300"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Upload size={32} />
            </div>
            <h3 className="text-xl font-semibold text-slate-800">拖拽 CSV 文件到这里</h3>
            <p className="text-slate-500 mt-2 max-w-xs">或者点击下方按钮从您的电脑中选择文件进行解析。</p>
            
            <label className="mt-6 cursor-pointer">
              <input 
                type="file" 
                accept=".csv" 
                className="hidden" 
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
              />
              <span className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 inline-block">
                选择 CSV 文件
              </span>
            </label>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* AI Analysis Section */}
            <AnimatePresence>
              {analysis && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-purple-50/50 border border-purple-100 rounded-2xl overflow-hidden"
                >
                  <div 
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-purple-100/50 transition-colors"
                  >
                    <div 
                      className="flex items-center gap-2 text-purple-700 font-semibold flex-1"
                      onClick={() => setShowAnalysis(!showAnalysis)}
                    >
                      <Sparkles size={20} />
                      <span>AI 数据洞察报告</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); exportAnalysisMarkdown(); }}
                        className="p-2 hover:bg-purple-200/50 rounded-lg text-purple-600 transition-colors flex items-center gap-1.5 text-xs font-medium border border-purple-200"
                        title="导出 Markdown 报告"
                      >
                        <Download size={14} />
                        导出 MD
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(); }}
                        className="p-2 hover:bg-purple-200/50 rounded-lg text-purple-600 transition-colors flex items-center gap-1.5 text-xs font-medium"
                        title="复制报告"
                      >
                        {isCopied ? <span className="text-green-600">已复制!</span> : <><Languages size={14} /> 复制</>}
                      </button>
                      <div 
                        className="p-2 hover:bg-purple-200/50 rounded-lg text-purple-400 transition-colors"
                        onClick={() => setShowAnalysis(!showAnalysis)}
                      >
                        {showAnalysis ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </div>
                  </div>
                  
                  {showAnalysis && (
                    <div className="p-6 pt-0">
                      <div className="bg-white/80 rounded-xl p-6 border border-purple-100/50 shadow-sm prose prose-slate max-w-none prose-sm prose-purple prose-headings:text-purple-900 prose-strong:text-purple-800 prose-table:border prose-table:border-purple-100 prose-th:bg-purple-50 prose-th:px-4 prose-th:py-2 prose-td:px-4 prose-td:py-2">
                        <Markdown remarkPlugins={[remarkGfm]}>{analysis}</Markdown>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Controls Bar */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text"
                  placeholder="搜索表格内容..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={exportProcessedCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all shadow-sm shadow-blue-100"
                >
                  <Download size={16} />
                  导出处理后 CSV
                </button>
                <div className="h-4 w-px bg-slate-200" />
                <div className="flex items-center gap-2 text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full border border-blue-100">
                  <Info size={14} />
                  <span>系统已自动识别并格式化数值单位</span>
                </div>
                <div className="h-4 w-px bg-slate-200" />
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <div className="flex items-center gap-2">
                    <FileText size={16} />
                    <span className="font-medium text-slate-700">{fileName}</span>
                  </div>
                  <div className="h-4 w-px bg-slate-200" />
                  <span>共 {filteredAndSortedData.length} 条记录</span>
                </div>
              </div>
            </div>

            {/* Table Container */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                    <tr>
                      {headers.map((header) => (
                        <th 
                          key={header}
                          onClick={() => handleSort(header)}
                          className="px-6 py-4 text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-100 transition-colors group whitespace-nowrap"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-900">
                                {translatedHeaders[header] || header}
                              </span>
                              <span className={cn(
                                "transition-colors",
                                sortConfig.key === header ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400"
                              )}>
                                {sortConfig.key === header ? (
                                  sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                ) : (
                                  <ArrowUpDown size={14} />
                                )}
                              </span>
                            </div>
                            {translatedHeaders[header] && (
                              <span className="text-[10px] text-slate-400 font-normal truncate max-w-[150px]" title={header}>
                                {header}
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence mode="popLayout">
                      {filteredAndSortedData.map((row, idx) => (
                        <motion.tr 
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          key={idx}
                          className="hover:bg-blue-50/30 transition-colors group"
                        >
                          {headers.map((header) => {
                            const format = getColumnFormat(header);
                            const value = row[header];
                            return (
                              <td key={header} className={cn(
                                "px-6 py-4 text-sm whitespace-nowrap",
                                format === 'text' ? "text-slate-600" : "text-slate-900 font-medium font-mono"
                              )}>
                                {formatValue(value, format)}
                              </td>
                            );
                          })}
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                  {summaryData && (
                    <tfoot className="sticky bottom-0 z-10 bg-slate-100 border-t-2 border-slate-300 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                      <tr className="font-bold">
                        {headers.map((header, idx) => {
                          const format = getColumnFormat(header);
                          const value = summaryData[header];
                          return (
                            <td key={header} className={cn(
                              "px-6 py-4 text-sm whitespace-nowrap",
                              format === 'text' ? "text-slate-500 italic" : "text-blue-700 font-mono"
                            )}>
                              {idx === 0 && !value ? "汇总 (Total/Avg)" : (value !== null ? formatValue(value, format) : "-")}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              
              {filteredAndSortedData.length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  <Filter className="mx-auto mb-4 opacity-20" size={48} />
                  <p>没有找到匹配的记录</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
