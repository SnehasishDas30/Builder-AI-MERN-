import React, { useMemo, useState } from 'react'
import { detectDependencies } from '../utils/sandpackUtils';
import { SandpackLayout, SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react';
import SandpackErrorMonitor from './SandpackErrorMonitor';

const FullPagePreview = ({files}) => {

    const [showErrorOverlay, setShowErrorOverlay] = useState(true)
    const [showCode, setShowCode] = useState(false);

      //Convert liveFiles to Sandpack format 
      const sandpackFiles = useMemo(() => {
        if(!files) return {};
        const spFiles = {};
        for (const [path, content] of Object.entries(files)) {
            spFiles[path] = { code: content }
        }
        return spFiles;
    }, [files])

    // Detect dependencies from import statements using liveFiles

    const dependencies = useMemo(() => {
        if(!files) return {};

        return detectDependencies(files)
    }, [files])

  return (
    <div className="h-screen w-screen bg-white overflow-hidden">
    <SandpackProvider template='react'
        files={sandpackFiles}
        customSetup={{ dependencies }}
        options={{
            externalResources: [
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
            ],
            
            logLevel: 0,
        }}
        className='h-full w-full'>

       
        <SandpackErrorMonitor onErrorChange={setShowErrorOverlay} />
        <SandpackLayout className="h-full w-full border-none! bg-transparent!"
           >

            {showCode && (
                <SandpackCodeEditor showTabs showLineNumbers showInlineErrors
                    wrapContent style={{ height: "100%", flex: 1, minWidth: 0 }} />
            )}

            <SandpackPreview showNavigator={false}
             showRefreshButton={false}
                showOpenInCodeSandbox={false}
                 showSandpackErrorOverlay={showErrorOverlay}
                className='h-full w-full' />

        </SandpackLayout>
    </SandpackProvider>

</div>
  )
}

export default FullPagePreview
