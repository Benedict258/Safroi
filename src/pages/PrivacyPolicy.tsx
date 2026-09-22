import React, { useEffect } from 'react';
import { ArrowLeft, Shield, Lock, FileText, ChevronRight } from 'lucide-react';

interface PrivacyPolicyProps {
  onBack: () => void;
  onNavigateTerms?: () => void;
}

export function PrivacyPolicy({ onBack, onNavigateTerms }: PrivacyPolicyProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-[#050B10] text-white p-4 sm:p-6 md:p-12 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8 md:space-y-12 pb-24">
        {/* Navigation / Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
          <button 
            onClick={onBack}
            className="group flex items-center gap-2 text-white/60 hover:text-white transition-colors w-fit"
          >
            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform text-mint" />
            <span className="font-bold text-sm">Back</span>
          </button>
          
          <div className="flex items-center gap-3">
            {onNavigateTerms && (
              <button
                onClick={onNavigateTerms}
                className="flex items-center gap-2 text-xs font-bold text-mint hover:text-mint/80 bg-mint/10 border border-mint/20 px-3 py-1.5 rounded-lg transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                View Terms of Service
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="flex items-center gap-2 text-xs font-mono text-white/40 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
              <Shield className="h-3.5 w-3.5 text-mint" />
              <span>Safroi Privacy</span>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mint/10 border border-mint/30 text-mint text-xs font-bold uppercase tracking-wider">
            <Lock className="h-3.5 w-3.5" />
            Data Protection & Transparency
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black italic uppercase tracking-tight">
            Privacy <span className="text-mint">Policy</span>
          </h1>
          <p className="text-sm font-medium text-white/40">
            Last Updated: March 2026
          </p>
        </div>

        {/* Content Body */}
        <div className="bg-[#0B1219] border border-white/10 rounded-2xl p-6 sm:p-8 md:p-10 space-y-10 text-white/80 font-normal leading-relaxed text-sm md:text-base">
          
          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">01.</span> Introduction
            </h2>
            <p className="text-white/70">
              This Privacy Policy explains how Safroi (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) collects, uses, stores, and protects information when you use our website, web application, and browser extension (together, the &quot;Service&quot;). We built Safroi to help people understand what they&apos;re agreeing to — we take handling your data responsibly seriously, especially given the sensitive nature of the documents people upload.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">02.</span> Information We Collect
            </h2>
            <div className="space-y-4 pl-2">
              <div>
                <h3 className="font-bold text-white text-sm mb-1">2.1 Account Information</h3>
                <p className="text-white/70 text-sm">
                  When you create an account, we collect information such as your name and email address, and any other details you provide during signup.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-white text-sm mb-1">2.2 Uploaded Documents</h3>
                <p className="text-white/70 text-sm">
                  When you upload a contract, agreement, or other document (as a photo or PDF) for analysis, we process the content of that document to generate your risk analysis and explanations.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-white text-sm mb-1">2.3 Browser Extension Data</h3>
                <p className="text-white/70 text-sm">
                  When you use the Safroi browser extension, it scans the terms of service and privacy policy of websites you visit (when enabled) to provide you with a risk assessment before you agree to those terms. The extension also tracks whether a previously-scanned site&apos;s policy has changed, so it can notify you of updates.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-white text-sm mb-1">2.4 Usage Information</h3>
                <p className="text-white/70 text-sm">
                  We may collect information about how you interact with the Service — pages visited, features used, and similar technical/usage data — to help us maintain and improve Safroi.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">03.</span> How We Use Your Information
            </h2>
            <p className="text-white/70">We use the information we collect to:</p>
            <ul className="list-disc pl-6 space-y-1.5 text-white/70">
              <li>Provide the core Service: analyzing documents and web pages, generating plain-language explanations, caution ratings, and translations</li>
              <li>Maintain your account and authenticate your access</li>
              <li>Notify you of policy changes on websites you&apos;ve previously scanned via the extension</li>
              <li>Improve and maintain the reliability and accuracy of the Service</li>
              <li>Communicate with you about your account or the Service, where necessary</li>
            </ul>
            <p className="text-white/90 font-medium mt-3 bg-mint/5 p-3 rounded-lg border border-mint/20">
              We do not sell your personal information or the content of your uploaded documents to third parties.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">04.</span> How Long We Keep Your Data
            </h2>
            <div className="space-y-3 pl-2 text-sm text-white/70">
              <p>
                <strong className="text-white">Uploaded documents:</strong> You control how long Safroi retains your uploaded documents. You can choose a retention period at the time of upload, and documents are removed from our systems once that period elapses, or sooner if you delete them manually.
              </p>
              <p>
                <strong className="text-white">Account information:</strong> We retain your account information for as long as your account remains active. If you delete your account, we will remove your account information within a reasonable period, except where we are required to retain certain data for legal or security purposes.
              </p>
              <p>
                <strong className="text-white">Extension scan data:</strong> Data related to website policy scans (used to detect and notify you of changes) is retained for as long as needed to provide that feature, or until you disable/uninstall the extension.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">05.</span> Third-Party AI Processing
            </h2>
            <p className="text-white/70">
              To generate risk analysis, plain-language explanations, and translations, Safroi transmits document and webpage text to third-party AI infrastructure providers for processing. This means the content of what you upload or what the extension scans may be sent to and processed by these providers as part of generating your results. We choose providers based on reasonable data-handling and security practices, but we do not have direct control over their internal infrastructure. We do not knowingly send more data to these providers than is necessary to generate your analysis.
            </p>
            <p className="text-white/70">
              Uploaded images are also screened by an automated content-safety check before analysis, to help ensure the Service isn&apos;t used to process inappropriate or harmful content.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">06.</span> How We Protect Your Information
            </h2>
            <p className="text-white/70">
              We use reasonable technical and organizational measures to protect your information, including secure transmission of data and access controls on stored documents. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">07.</span> Your Choices and Rights
            </h2>
            <p className="text-white/70">
              Depending on your location, you may have rights to access, correct, or delete your personal information, and to control how it&apos;s used. You can:
            </p>
            <ul className="list-disc pl-6 space-y-1.5 text-white/70">
              <li>Set and adjust your document retention period at any time</li>
              <li>Delete uploaded documents manually</li>
              <li>Delete your account, which removes your account information per Section 4</li>
              <li>Disable the browser extension&apos;s scanning feature at any time</li>
            </ul>
            <p className="text-white/70 mt-2">
              To exercise any of these rights or ask questions about your data, contact us at{' '}
              <a href="mailto:privacy@safroi.com" className="text-mint underline hover:text-mint/80">
                privacy@safroi.com
              </a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">08.</span> Children&apos;s Privacy
            </h2>
            <p className="text-white/70">
              Safroi is not intended for use by individuals under 18 years of age. We do not knowingly collect information from children under this age. If you believe a child has provided us with personal information, please contact us so we can address it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">09.</span> International Data & Applicable Law
            </h2>
            <p className="text-white/70">
              Safroi serves users across multiple jurisdictions, adhering to applicable privacy guidelines and recognized data protection frameworks (such as the NDPR and GDPR principles) regarding fair processing, user consent, and purpose limitation.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">10.</span> Changes to This Policy
            </h2>
            <p className="text-white/70">
              We may update this Privacy Policy from time to time. If we make material changes, we will provide notice through the Service or by other reasonable means. The &quot;Last Updated&quot; date at the top of this page reflects the most recent revision.
            </p>
          </section>

          <section className="space-y-3 border-t border-white/10 pt-6">
            <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <span className="text-mint font-mono text-sm">11.</span> Contact Us
            </h2>
            <p className="text-white/70">
              If you have questions or concerns about this Privacy Policy or how your data is handled, contact us at{' '}
              <a href="mailto:privacy@safroi.com" className="text-mint underline hover:text-mint/80">
                privacy@safroi.com
              </a>.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
