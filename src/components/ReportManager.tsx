import React, { useState } from 'react';
import { 
  FileText, 
  Trash2, 
  Download, 
  X, 
  CheckCircle2, 
  FileDown,
  LogOut,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReportItem } from '../App';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface ReportManagerProps {
  reportItems: ReportItem[];
  setReportItems: React.Dispatch<React.SetStateAction<ReportItem[]>>;
  onClearSession: () => void;
}

export default function ReportManager({ reportItems, setReportItems, onClearSession }: ReportManagerProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const removeItem = (id: string) => {
    setReportItems(prev => prev.filter(item => item.id !== id));
    toast.success("Item removed from report");
  };

  const generatePDF = async () => {
    if (reportItems.length === 0) {
      toast.error("No items in report to export");
      return;
    }

    setIsExporting(true);
    const toastId = toast.loading("Generating consolidated PDF report...");

    try {
      // Ensure jsPDF is available
      let pdf: any;
      try {
        pdf = new jsPDF('p', 'mm', 'a4');
      } catch (e) {
        console.error("jsPDF constructor failed, trying default import", e);
        // @ts-ignore
        const jsPDFDefault = (await import('jspdf')).default;
        // @ts-ignore
        pdf = new (jsPDFDefault || jsPDF)('p', 'mm', 'a4');
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      // Title Page
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      
      pdf.setTextColor(15, 23, 42); // Slate 900
      pdf.setFontSize(28);
      pdf.text("BESS Optimization Report", pageWidth / 2, 60, { align: 'center' });
      
      pdf.setFontSize(14);
      pdf.setTextColor(100, 116, 139); // Slate 500
      pdf.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, 80, { align: 'center' });
      
      pdf.setFontSize(12);
      pdf.text("VGSOM EMBA Project - Intelligent Energy Solutions", pageWidth / 2, 280, { align: 'center' });

      // Process each item
      for (let i = 0; i < reportItems.length; i++) {
        const item = reportItems[i];
        pdf.addPage();
        
        // Header for each page
        pdf.setFillColor(248, 250, 252); // Slate 50
        pdf.rect(0, 0, pageWidth, 20, 'F');
        pdf.setDrawColor(226, 232, 240); // Slate 200
        pdf.line(0, 20, pageWidth, 20);
        
        pdf.setTextColor(15, 23, 42); // Slate 900
        pdf.setFontSize(14);
        pdf.text(item.title, margin, 13);
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139); // Slate 500
        pdf.text(item.timestamp, pageWidth - margin, 13, { align: 'right' });

        try {
          if (item.imageData) {
            // Use pre-captured image data
            const img = new Image();
            img.src = item.imageData;
            await new Promise((resolve) => { img.onload = resolve; });

            const imgWidth = pageWidth - (2 * margin);
            const imgHeight = (img.height * imgWidth) / img.width;
            
            const contentHeight = pageHeight - 40; // Available height per page
            
            if (imgHeight <= contentHeight) {
              pdf.addImage(item.imageData, 'PNG', margin, 25, imgWidth, imgHeight);
            } else {
              // Multi-page image handling with canvas cropping
              let heightLeft = imgHeight;
              let pageCount = 0;
              const pxToMm = img.height / imgHeight;
              const pageHeightPx = contentHeight * pxToMm;

              while (heightLeft > 0) {
                if (pageCount > 0) {
                  pdf.addPage();
                  // Redraw header for continued pages
                  pdf.setFillColor(248, 250, 252);
                  pdf.rect(0, 0, pageWidth, 20, 'F');
                  pdf.setDrawColor(226, 232, 240);
                  pdf.line(0, 20, pageWidth, 20);
                  pdf.setTextColor(15, 23, 42);
                  pdf.setFontSize(14);
                  pdf.text(`${item.title} (cont.)`, margin, 13);
                } else {
                  // First page header
                  pdf.setFillColor(248, 250, 252);
                  pdf.rect(0, 0, pageWidth, 20, 'F');
                  pdf.setDrawColor(226, 232, 240);
                  pdf.line(0, 20, pageWidth, 20);
                  pdf.setTextColor(15, 23, 42);
                  pdf.setFontSize(14);
                  pdf.text(item.title, margin, 13);
                  pdf.setFontSize(10);
                  pdf.setTextColor(100, 116, 139);
                  pdf.text(item.timestamp, pageWidth - margin, 13, { align: 'right' });
                }

                // Create a temporary canvas to crop the image part for this page
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = img.width;
                cropCanvas.height = Math.min(pageHeightPx, img.height - (pageCount * pageHeightPx));
                
                const ctx = cropCanvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(
                    img, 
                    0, pageCount * pageHeightPx, img.width, cropCanvas.height, // Source
                    0, 0, cropCanvas.width, cropCanvas.height // Destination
                  );
                  
                  const pageImgData = cropCanvas.toDataURL('image/png');
                  pdf.addImage(pageImgData, 'PNG', margin, 25, imgWidth, (cropCanvas.height / pxToMm));
                }

                heightLeft -= contentHeight;
                pageCount++;
              }
            }
          } else {
            const element = document.getElementById(item.elementId);
            if (element) {
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Ultimate Style Shield: Bake computed styles to standard colors to prevent html2canvas parser errors
              const restoredStyles = new Map<HTMLElement, string>();
              const colorConverter = document.createElement('canvas').getContext('2d');
              
              const bakeStyles = (root: HTMLElement) => {
                const elements = root.getElementsByTagName('*');
                for (let j = 0; j < elements.length; j++) {
                  const el = elements[j] as HTMLElement;
                  try {
                    const style = window.getComputedStyle(el);
                    // Comprehensive list of properties to bake (layout + colors)
                    const props = [
                      'color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 
                      'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
                      'outlineColor', 'stopColor', 'floodColor', 'lightingColor',
                      'columnRuleColor', 'textDecorationColor', 'caretColor',
                      'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
                      'padding', 'margin', 'display', 'flexDirection', 'justifyContent', 'alignItems',
                      'gap', 'width', 'height', 'position', 'top', 'left', 'right', 'bottom', 'zIndex',
                      'opacity', 'visibility', 'overflow', 'borderRadius', 'boxShadow', 'borderStyle', 'borderWidth',
                      'flex', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'alignSelf', 'justifySelf',
                      'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'boxSizing'
                    ];
                    let modified = false;
                    const originalInline = el.getAttribute('style') || '';
                    
                    props.forEach(prop => {
                      const val = style.getPropertyValue(prop);
                      if (val) {
                        let safeVal = val;
                        // Convert oklch/oklab to safe hex
                        if (val.includes('oklch') || val.includes('oklab')) {
                          if (colorConverter) {
                            colorConverter.fillStyle = val;
                            safeVal = colorConverter.fillStyle;
                          } else {
                            safeVal = '#334155';
                          }
                        }
                        // Always bake the value to preserve layout when stylesheets are removed
                        el.style.setProperty(prop, safeVal, 'important');
                        modified = true;
                      }
                    });
                    
                    // Also check for gradients in background-image
                    const bgImg = style.getPropertyValue('background-image');
                    if (bgImg && (bgImg.includes('oklch') || bgImg.includes('oklab'))) {
                      el.style.setProperty('background-image', 'none', 'important');
                      el.style.setProperty('background-color', '#334155', 'important');
                      modified = true;
                    }
                    
                    if (modified) {
                      restoredStyles.set(el, originalInline);
                    }
                  } catch (e) {}
                }
              };

              if (element) {
                bakeStyles(element);
              }

              // Nuclear Option: Temporarily REMOVE all style and link tags from the head
              // to prevent html2canvas from even attempting to parse them.
              const head = document.head;
              const styleRelatedTags = Array.from(head.querySelectorAll('style, link[rel="stylesheet"]'));
              const removedTags: { tag: Node, nextSibling: Node | null }[] = [];
              
              styleRelatedTags.forEach(tag => {
                // Keep font stylesheets as they are usually safe and needed for text rendering
                if (tag instanceof HTMLLinkElement && tag.href.includes('fonts.googleapis.com')) {
                  return;
                }
                removedTags.push({ tag, nextSibling: tag.nextSibling });
                try {
                  head.removeChild(tag);
                } catch (e) {}
              });

              try {
                // Add a timeout to html2canvas to prevent hanging
                const canvasPromise = html2canvas(element, {
                  scale: 2,
                  useCORS: true,
                  allowTaint: true,
                  backgroundColor: '#ffffff',
                  logging: false,
                  onclone: (clonedDoc) => {
                    // 1. Sanitize all inline styles in the clone
                    const allElements = clonedDoc.querySelectorAll('*');
                    allElements.forEach(el => {
                      const styleAttr = el.getAttribute('style');
                      if (styleAttr && (styleAttr.includes('oklch') || styleAttr.includes('oklab'))) {
                        el.setAttribute('style', styleAttr.replace(/okl(ch|ab)\s*\([\s\S]*?\)/gi, '#334155'));
                      }
                    });

                    // 2. Remove all link and style tags in the clone to prevent parser errors
                    const styleRelated = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
                    styleRelated.forEach(tag => {
                      try {
                        tag.parentNode?.removeChild(tag);
                      } catch (e) {}
                    });

                    // 3. Inject a master "Light Theme" stylesheet
                    const style = clonedDoc.createElement('style');
                    style.textContent = `
                      * {
                        color-scheme: light !important;
                        -webkit-print-color-adjust: exact !important;
                      }
                      body, #predictor-full-content, #optimizer-full-content, #predictor-results, #optimizer-results, #financials-full-content { 
                        background-color: #ffffff !important; 
                        color: #0f172a !important; 
                        width: 100% !important;
                        max-width: 1200px !important;
                        margin: 0 auto !important;
                      }
                      .recharts-responsive-container {
                        min-height: 350px !important;
                        height: 350px !important;
                      }
                      /* Fallback for common backgrounds */
                      [class*="bg-"] { background-color: #ffffff !important; }
                      [class*="text-"] { color: #0f172a !important; }
                      .text-slate-400, .text-slate-500 { color: #64748b !important; }
                    `;
                    clonedDoc.head.appendChild(style);
                  }
                });

                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error("Capture timed out (15s)")), 15000)
                );

                const canvas = await Promise.race([canvasPromise, timeoutPromise]) as HTMLCanvasElement;
                
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = pageWidth - (2 * margin);
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                const contentHeight = pageHeight - 40;
                
                if (imgHeight <= contentHeight) {
                  pdf.addImage(imgData, 'PNG', margin, 25, imgWidth, imgHeight);
                } else {
                  // Multi-page splitting for direct capture
                  let heightLeft = imgHeight;
                  let pageCount = 0;
                  const pxToMm = canvas.height / imgHeight;
                  const pageHeightPx = contentHeight * pxToMm;

                  while (heightLeft > 0) {
                    if (pageCount > 0) {
                      pdf.addPage();
                      pdf.setFillColor(248, 250, 252);
                      pdf.rect(0, 0, pageWidth, 20, 'F');
                      pdf.setDrawColor(226, 232, 240);
                      pdf.line(0, 20, pageWidth, 20);
                      pdf.setTextColor(15, 23, 42);
                      pdf.setFontSize(14);
                      pdf.text(`${item.title} (cont.)`, margin, 13);
                    }

                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = canvas.width;
                    cropCanvas.height = Math.min(pageHeightPx, canvas.height - (pageCount * pageHeightPx));
                    
                    const ctx = cropCanvas.getContext('2d');
                    if (ctx) {
                      ctx.drawImage(
                        canvas, 
                        0, pageCount * pageHeightPx, canvas.width, cropCanvas.height,
                        0, 0, cropCanvas.width, cropCanvas.height
                      );
                      
                      const pageImgData = cropCanvas.toDataURL('image/png');
                      pdf.addImage(pageImgData, 'PNG', margin, 25, imgWidth, (cropCanvas.height / pxToMm));
                    }

                    heightLeft -= (cropCanvas.height / pxToMm);
                    pageCount++;
                  }
                }
              } finally {
                // Restore original tags
                removedTags.reverse().forEach(({ tag, nextSibling }) => {
                  head.insertBefore(tag, nextSibling);
                });

                // Restore baked styles
                restoredStyles.forEach((original, el) => {
                  if (original) {
                    el.setAttribute('style', original);
                  } else {
                    el.removeAttribute('style');
                  }
                });
              }
            } else {
              pdf.setTextColor(100, 100, 100);
              pdf.text("Data visualization not available for this item.", margin, 40);
            }
          }
        } catch (itemError) {
          console.error(`Error capturing item ${item.title}:`, itemError);
          pdf.setTextColor(239, 68, 68);
          pdf.text(`Error capturing visualization for: ${item.title}`, margin, 40);
          pdf.text(`Technical Error: ${itemError instanceof Error ? itemError.message : String(itemError)}`, margin, 50);
        }
      }

      pdf.save(`BESS_Consolidated_Report_${new Date().getTime()}.pdf`);
      toast.success("PDF Report generated successfully!", { id: toastId });
    } catch (error) {
      console.error("PDF Generation Error:", error);
      toast.error(`Failed to generate PDF report: ${error instanceof Error ? error.message : String(error)}`, { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="mt-12 space-y-6 border-t border-slate-800 pt-12 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="text-blue-400" />
            Report Manager
          </h2>
          <p className="text-slate-400 text-sm mt-1">Consolidate your findings into a single PDF document</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-900/20 text-red-400 border border-red-500/20 hover:bg-red-900/40 transition-all text-sm font-bold"
          >
            <LogOut className="w-4 h-4" />
            End Session
          </button>
          
          <button
            onClick={generatePDF}
            disabled={isExporting || reportItems.length === 0}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-bold shadow-lg shadow-blue-600/20"
          >
            {isExporting ? <Download className="w-4 h-4 animate-bounce" /> : <FileDown className="w-4 h-4" />}
            Export Consolidated PDF ({reportItems.length})
          </button>
        </div>
      </div>

      {/* Staged Items Grid */}
      {reportItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {reportItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-slate-700 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-slate-800 p-2 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{item.title}</h4>
                    <p className="text-[10px] text-slate-500">{item.timestamp}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-12 text-center">
          <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-slate-300 font-bold">No items staged for report</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">
            Run a predictor or optimizer and click "Include in Report" to start building your consolidated document.
          </p>
        </div>
      )}

      {/* Clear Session Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-md w-full shadow-2xl"
            >
              <div className="bg-red-900/20 w-16 h-16 rounded-full flex items-center justify-center mb-6">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">End Session & Clear All?</h3>
              <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                This will permanently clear all predicted prices, optimization results, and your staged report items. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onClearSession();
                    setShowClearConfirm(false);
                    toast.success("Session cleared successfully");
                  }}
                  className="flex-1 px-6 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-500 transition-all"
                >
                  Yes, Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
