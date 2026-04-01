const currentScriptElement = document.currentScript



function saveAnchorData(anchorObject, days=1) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `siteGuide=${encodeURIComponent(JSON.stringify(anchorObject))}; expires=${expires}; path=/; SameSite=Lax`;
}



function loadAnchorData() {
    const value = `; ${document.cookie}`
    const parts = value.split(`; siteGuide=`)

    if (parts.length === 2) {
        const data = decodeURIComponent(parts.pop().split(';')[0])
        document.cookie = `siteGuide=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`
        return JSON.parse(data)
    }

    return null
}



let activeHighlightedElement = null
let highlightObserverFunctions = []
let canClearHighlights = false

const anchorData = loadAnchorData()

if (anchorData && anchorData.text) {
    findAndScroll(anchorData)
}

function clearHighlights() {
    const highlightElements = document.querySelectorAll("div[dataHighlightActive='true']")
    highlightElements.forEach((highlightElement) => {
        highlightElement.style.transition = "all 0.2s ease, opacity 0.2s ease"
        highlightElement.style.opacity = "0"
        setTimeout(() => {
            highlightElement.remove()
        }, 200)
    })

    highlightObserverFunctions.forEach((observerFunction) => {
        window.removeEventListener("scroll", observerFunction)
        window.removeEventListener("resize", observerFunction)
    })

    highlightObserverFunctions = []
    activeHighlightedElement = null
}

document.addEventListener("click", function (event) {
    if (!canClearHighlights) {
        return
    }

    if (event.target.id == "siteGuideNavigateButton"){
        return
    }

    clearHighlights()
    canClearHighlights = false
})

function getTextNodeForOffset(element, offset) {
    let currentOffset = 0
    const treeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false)
    let currentNode

    while ((currentNode = treeWalker.nextNode())) {
        const nodeLength = currentNode.textContent.length

        if (currentOffset + nodeLength >= offset) {
            return {
                node: currentNode,
                localOffset: offset - currentOffset
            }
        }

        currentOffset += nodeLength
    }

    return null
}

function mergeOverlappingRectangles(rectangles, margin = 2) {
    if (!rectangles.length) {
        return []
    }

    const expanded = rectangles.map(rectangle => ({
        left: rectangle.left - margin,
        top: rectangle.top - margin,
        right: rectangle.left + rectangle.width + margin,
        bottom: rectangle.top + rectangle.height + margin
    }))

    expanded.sort((a, b) => a.top - b.top || a.left - b.left)

    const merged = []

    for (const rectangle of expanded) {
        let mergedIntoExisting = false

        for (const existing of merged) {
            const overlaps =
                rectangle.left <= existing.right &&
                rectangle.right >= existing.left &&
                rectangle.top <= existing.bottom &&
                rectangle.bottom >= existing.top

            if (overlaps) {
                existing.left = Math.min(existing.left, rectangle.left)
                existing.top = Math.min(existing.top, rectangle.top)
                existing.right = Math.max(existing.right, rectangle.right)
                existing.bottom = Math.max(existing.bottom, rectangle.bottom)
                mergedIntoExisting = true
                break
            }
        }

        if (!mergedIntoExisting) {
            merged.push({ ...rectangle })
        }
    }

    return merged.map(rectangle => ({
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.right - rectangle.left,
        height: rectangle.bottom - rectangle.top
    }))
}

function openParentDetailsElements(element) {
    let currentElement = element

    while (currentElement) {
        if (currentElement.tagName === "DETAILS" && !currentElement.open) {
            currentElement.open = true
        }

        currentElement = currentElement.parentElement
    }
}
function highlightTextOverlay(element, searchText) {
    openParentDetailsElements(element)

    const originalText = element.textContent
    const normalizedElementText = originalText.replace(/\s+/g, " ").trim().toLowerCase()
    const normalizedSearchText = searchText.replace(/\s+/g, " ").trim().toLowerCase()
    const normalizedStartIndex = normalizedElementText.indexOf(normalizedSearchText)

    if (normalizedStartIndex === -1) return

    let realStartIndex = 0
    let normalizedIndex = 0
    while (normalizedIndex < normalizedStartIndex && realStartIndex < originalText.length) {
        if (/\s/.test(originalText[realStartIndex])) {
            while (/\s/.test(originalText[realStartIndex])) realStartIndex++
            normalizedIndex++
        } else {
            realStartIndex++
            normalizedIndex++
        }
    }

    let realEndIndex = realStartIndex
    let matchedCharacterCount = 0
    while (matchedCharacterCount < normalizedSearchText.length && realEndIndex < originalText.length) {
        if (/\s/.test(originalText[realEndIndex])) {
            while (/\s/.test(originalText[realEndIndex])) realEndIndex++
            matchedCharacterCount++
        } else {
            realEndIndex++
            matchedCharacterCount++
        }
    }

    const startNodeInfo = getTextNodeForOffset(element, realStartIndex)
    const endNodeInfo = getTextNodeForOffset(element, realEndIndex)
    if (!startNodeInfo || !endNodeInfo) return

    const textRange = document.createRange()
    textRange.setStart(startNodeInfo.node, startNodeInfo.localOffset)
    textRange.setEnd(endNodeInfo.node, endNodeInfo.localOffset)
    let highlightRectangles = []

    function calculateRectangles() {
        function expandRangeEnd(node, offset) {
            const punctuationRegex = /[.,!?;: ]/

            if (offset < node.textContent.length) {
                const character = node.textContent[offset]

                if (!punctuationRegex.test(character) || /\d/.test(character)) {
                    return { node, offset: offset + 1 }
                }

                return { node, offset }
            }

            let next = node.nextSibling

            while (next) {
                if (next.nodeType === Node.TEXT_NODE && next.textContent.length > 0) {
                    const firstCharacter = next.textContent[0]
                    if (!punctuationRegex.test(firstCharacter) || /\d/.test(firstCharacter)) {
                        return { node: next, offset: 1 }
                    }
                    return { node: next, offset: 0 }
                }
                next = next.nextSibling
            }

            return { node, offset }
        }

        const expandedEnd = expandRangeEnd(endNodeInfo.node, endNodeInfo.localOffset)

        textRange.setStart(startNodeInfo.node, startNodeInfo.localOffset)
        textRange.setEnd(expandedEnd.node, expandedEnd.offset)

        highlightRectangles = mergeOverlappingRectangles(Array.from(textRange.getClientRects()), 3)
    }

    calculateRectangles()

    function createHighlights() {
        document.querySelectorAll("div[dataHighlightActive='true']").forEach(element => element.remove())

        for (const rectangle of highlightRectangles) {
            const highlightElement = document.createElement("div")
            highlightElement.style.position = "absolute"
            highlightElement.style.left = `${rectangle.left + window.pageXOffset}px`
            highlightElement.style.top = `${rectangle.top + window.pageYOffset}px`
            highlightElement.style.width = `${rectangle.width}px`
            highlightElement.style.height = `${rectangle.height}px`
            highlightElement.style.backgroundColor = "rgba(255,215,80,0.35)"
            highlightElement.style.outline = "2px solid rgba(255,185,50,0.95)"
            highlightElement.style.boxShadow = "0 0 0 6px rgba(255,220,120,0.2)"
            highlightElement.style.borderRadius = "3px"
            highlightElement.style.pointerEvents = "none"
            highlightElement.style.transition = "none"
            highlightElement.style.pointerEvents = "auto"
            highlightElement.setAttribute("dataHighlightActive", "true")
            document.body.appendChild(highlightElement)
        }
    }

    function updateHighlightPositions(recalculateRectangles = false) {
        if (recalculateRectangles) calculateRectangles()
        document.querySelectorAll("div[dataHighlightActive='true']").forEach((el, i) => {
            const rect = highlightRectangles[i]
            el.style.left = `${rect.left + window.pageXOffset}px`
            el.style.top = `${rect.top + window.pageYOffset}px`
        })
    }

    window.addEventListener("resize", () => updateHighlightPositions(true))
    createHighlights()
    activeHighlightedElement = element
}

function findAndScroll(anchor) {
    const searchText = (anchor.text || "").toLowerCase()

    if (!searchText) {
        return
    }

    clearHighlights()

    const allElements = Array.from(document.body.querySelectorAll("*"))

    let bestMatchingElement = null
    let bestScore = Infinity

    function normalizeText(value) {
        return (value || "").toLowerCase().replace(/\s+/g, " ").trim()
    }

    const normalizedSearchText = normalizeText(searchText)

    const widgetElement = document.getElementById("siteGuideWidgetContainer")

    for (const element of allElements) {
        if (widgetElement && widgetElement.contains(element)) {
            continue
        }

        const tagName = element.tagName

        if (
            tagName === "BODY" ||
            tagName === "HTML" ||
            tagName === "SCRIPT" ||
            tagName === "STYLE" ||
            tagName === "NOSCRIPT"
        ) {
            continue
        }

        const textContent = element.textContent || ""
        const normalizedTextContent = normalizeText(textContent)

        if (!normalizedTextContent.includes(normalizedSearchText)) {
            continue
        }

        const score =
            Math.abs(normalizedTextContent.length - normalizedSearchText.length) +
            element.children.length * 80

        if (score < bestScore) {
            bestScore = score
            bestMatchingElement = element
        }
    }

    if (!bestMatchingElement) {
        return
    }

    bestMatchingElement.scrollIntoView({ behavior: "smooth", block: "center" })

    openParentDetailsElements(bestMatchingElement)
    highlightTextOverlay(bestMatchingElement, searchText)
    activeHighlightedElement = bestMatchingElement

    setTimeout(() => {
        canClearHighlights = true
    }, 500)
}



(function () {
    const themes = [
        {
            name: "Purple",
            primary: "#9b59b6",
            primarySoft: "rgba(155,89,182,0.15)",
            primaryGlow: "rgba(155,89,182,0.35)",
            text: "#ffffff",
            background: "#1a1a1a",
            cardBackground: "#222",
            cardBorder: "rgba(155,89,182,0.2)"
        },
        {
            name: "WarmOrange",
            primary: "#ff6f3c",
            primarySoft: "rgba(255,111,60,0.15)",
            primaryGlow: "rgba(255,111,60,0.35)",
            text: "#ffffff",
            background: "#1a1a1a",
            cardBackground: "#222",
            cardBorder: "rgba(255,111,60,0.2)"
        },
        {
            name: "Cyan",
            primary: "#00ffff",
            primarySoft: "rgba(0,255,255,0.15)",
            primaryGlow: "rgba(0,255,255,0.35)",
            text: "#ffffff",
            background: "#0a0a0a",
            cardBackground: "#111",
            cardBorder: "rgba(0,255,255,0.2)"
        }
    ]

    const requestedThemeName = currentScriptElement.getAttribute("theme")

    let selectedTheme = themes[0]

    if (requestedThemeName) {
        for (const themeObject of themes) {
            if (themeObject.name.toLowerCase() === requestedThemeName.toLowerCase()) {
                selectedTheme = themeObject
                break
            }
        }
    }

    const theme = selectedTheme

    const widgetContainer = document.createElement("div")
    widgetContainer.style.position = "fixed"
    widgetContainer.style.right = "20px"
    widgetContainer.style.bottom = "20px"
    widgetContainer.style.zIndex = "999999"
    widgetContainer.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    widgetContainer.style.transform = "translateX(120px)"
    widgetContainer.style.opacity = "0"
    widgetContainer.style.transition = "transform 0.5s ease, opacity 0.5s ease"
    widgetContainer.id = "siteGuideWidgetContainer"

    requestAnimationFrame(() => {
        widgetContainer.style.transform = "translateX(0)"
        widgetContainer.style.opacity = "1"
    })

    let widgetIsOpen = false

    const widget = document.createElement("div")
    widget.style.width = "64px"
    widget.style.height = "64px"
    widget.style.borderRadius = "50%"
    widget.style.background = `linear-gradient(135deg, ${theme.background}, #111)`
    widget.style.boxShadow = `0 2px 12px rgba(0,0,0,0.4), 0 0 12px ${theme.primaryGlow}`
    widget.style.display = "flex"
    widget.style.alignItems = "center"
    widget.style.justifyContent = "center"
    widget.style.cursor = "pointer"
    widget.style.transition = "all 0.25s ease"
    widget.style.overflow = "hidden"
    widget.style.border = `1px solid ${theme.primarySoft}`

    widget.addEventListener("mouseenter", () => {
        widget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.5), 0 0 16px ${theme.primaryGlow}`
    })

    widget.addEventListener("mouseleave", () => {
        widget.style.boxShadow = `0 2px 12px rgba(0,0,0,0.4), 0 0 12px ${theme.primaryGlow}`
    })

    widget.addEventListener("mousedown", () => {
        widget.style.boxShadow = `0 1px 6px rgba(0,0,0,0.5), 0 0 8px ${theme.primaryGlow}`
    })

    widget.addEventListener("mouseup", () => {
        widget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.5), 0 0 16px ${theme.primaryGlow}`
    })

    const logoContainer = document.createElement("div")
    logoContainer.style.position = "relative"
    logoContainer.style.width = "24px"
    logoContainer.style.height = "24px"
    logoContainer.style.display = "flex"
    logoContainer.style.alignItems = "center"
    logoContainer.style.justifyContent = "center"

    const logoCircle = document.createElement("div")
    logoCircle.style.width = "14px"
    logoCircle.style.height = "14px"
    logoCircle.style.borderRadius = "50%"
    logoCircle.style.border = `2px solid ${theme.primary}`
    logoCircle.style.background = `radial-gradient(circle at center, ${theme.primarySoft} 0%, transparent 60%)`
    logoCircle.style.boxShadow = `0 0 10px ${theme.primaryGlow}, 0 0 20px ${theme.primaryGlow}, inset 0 0 4px ${theme.primarySoft}`
    logoCircle.style.position = "absolute"
    logoCircle.style.left = "3px"
    logoCircle.style.top = "3px"

    const logoHandle = document.createElement("div")
    logoHandle.style.width = "9px"
    logoHandle.style.height = "3px"
    logoHandle.style.background = theme.primary
    logoHandle.style.position = "absolute"
    logoHandle.style.right = "-1px"
    logoHandle.style.bottom = "3px"
    logoHandle.style.transform = "rotate(45deg)"
    logoHandle.style.borderRadius = "2px"
    logoHandle.style.boxShadow = `0 0 6px ${theme.primaryGlow}`

    const activeCircle = document.createElement("div")
    activeCircle.style.width = "10px"
    activeCircle.style.height = "10px"
    activeCircle.style.borderRadius = "50%"
    activeCircle.style.background = theme.primary
    activeCircle.style.boxShadow = `0 0 10px ${theme.primaryGlow}, 0 0 20px ${theme.primaryGlow}`
    activeCircle.style.display = "none"

    logoContainer.appendChild(logoCircle)
    logoContainer.appendChild(logoHandle)
    logoContainer.appendChild(activeCircle)

    const inputElement = document.createElement("input")
    inputElement.type = "text"
    inputElement.placeholder = "Search..."
    inputElement.spellcheck = false
    inputElement.autocomplete = "off"
    inputElement.style.position = "absolute"
    inputElement.style.left = "42px"
    inputElement.style.right = "16px"
    inputElement.style.opacity = "0"
    inputElement.style.border = "none"
    inputElement.style.outline = "none"
    inputElement.style.background = "transparent"
    inputElement.style.color = theme.text
    inputElement.style.fontSize = "14px"
    inputElement.style.pointerEvents = "none"
    inputElement.style.transition = "opacity 0.2s ease"

    const resultContainer = document.createElement("div")
    resultContainer.style.position = "absolute"
    resultContainer.style.bottom = "80px"
    resultContainer.style.right = "0"
    resultContainer.style.width = "320px"
    resultContainer.style.maxHeight = "300px"
    resultContainer.style.overflowY = "auto"
    resultContainer.style.background = theme.cardBackground
    resultContainer.style.border = `1px solid ${theme.cardBorder}`
    resultContainer.style.borderRadius = "12px"
    resultContainer.style.boxShadow = `0 8px 30px rgba(0,0,0,0.5)`
    resultContainer.style.padding = "10px"
    resultContainer.style.display = "none"
    resultContainer.style.flexDirection = "column"
    resultContainer.style.gap = "8px"

    function createSkeletonCard() {
        const card = document.createElement("div")
        card.style.padding = "10px"
        card.style.borderRadius = "10px"
        card.style.background = theme.cardBackground
        card.style.overflow = "hidden"

        const shimmer = document.createElement("div")
        shimmer.style.height = "12px"
        shimmer.style.marginBottom = "8px"
        shimmer.style.borderRadius = "6px"
        shimmer.style.background = "linear-gradient(90deg, #111 25%, #1a1a1a 50%, #111 75%)"
        shimmer.style.backgroundSize = "200% 100%"
        shimmer.style.animation = "shimmerAnimation 2.2s infinite"

        const shimmer2 = shimmer.cloneNode()
        shimmer2.style.width = "80%"

        card.appendChild(shimmer)
        card.appendChild(shimmer2)

        return card
    }

    const style = document.createElement("style")
    style.innerHTML = `
        @keyframes shimmerAnimation {
            0% { background-position: 200% 0 }
            100% { background-position: -200% 0 }
        }
    `
    document.head.appendChild(style)

    widget.appendChild(logoContainer)
    widget.appendChild(inputElement)
    widgetContainer.appendChild(resultContainer)
    widgetContainer.appendChild(widget)
    document.body.appendChild(widgetContainer)

    function setIdleLogo() {
        logoCircle.style.display = "block"
        logoHandle.style.display = "block"
        activeCircle.style.display = "none"
    }

    function setActiveLogo() {
        logoCircle.style.display = "none"
        logoHandle.style.display = "none"
        activeCircle.style.display = "block"
    }

    function openWidget() {
        widget.style.width = "260px"
        widget.style.height = "48px"
        widget.style.borderRadius = "24px"
        widget.style.justifyContent = "flex-start"
        logoContainer.style.marginLeft = "14px"
        inputElement.style.opacity = "1"
        inputElement.style.pointerEvents = "auto"
        inputElement.focus()
        setActiveLogo()
    }

    function closeWidget() {
        widget.style.width = "64px"
        widget.style.height = "64px"
        widget.style.borderRadius = "50%"
        widget.style.justifyContent = "center"
        logoContainer.style.marginLeft = "0"
        inputElement.style.opacity = "0"
        inputElement.style.pointerEvents = "none"
        resultContainer.style.display = "none"
        setIdleLogo()
    }

    setIdleLogo()

    widget.addEventListener("click", function () {
        if (!widgetIsOpen) {
            widgetIsOpen = true
            openWidget()
        }
    })

    document.addEventListener("click", function (event) {
        if (!widgetContainer.contains(event.target)) {
            widgetIsOpen = false
            closeWidget()
        }
    })

    let debounce = false

    async function triggerSearch() {
        if (debounce) {
            return
        }

        debounce = true
        setTimeout(() => {
            debounce = false
        }, 1000)

        const query = inputElement.value.trim()

        if (!query) {
            return
        }

        resultContainer.innerHTML = ""
        resultContainer.style.display = "flex"
        resultContainer.style.flexDirection = "column"
        resultContainer.style.gap = "8px"

        const skeletonCards = []
        for (let skeletonIndex = 0; skeletonIndex < 2; skeletonIndex++) {
            const skeleton = createSkeletonCard()
            skeleton.style.opacity = "1"
            skeletonCards.push(skeleton)
            resultContainer.appendChild(skeleton)
        }

        resultContainer.style.transform = "translateX(120%)"
        resultContainer.style.opacity = "0"
        resultContainer.style.transition = "none"
        resultContainer.getBoundingClientRect()
        resultContainer.style.transition = "transform 0.5s ease, opacity 0.5s ease"

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                resultContainer.style.transform = "translateX(0)"
                resultContainer.style.opacity = "1"
                setTimeout(resolve, 500)
            })
        })

        try {
            const clientId = currentScriptElement.getAttribute("client-id")
            const response = await fetch("http://localhost:8000/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query, clientId: clientId })
            })

            if (!response.ok) {
                throw new Error("Network response was not ok")
            }

            const responseData = await response.json()

            const cardElement = document.createElement("div")
            cardElement.style.padding = "10px"
            cardElement.style.borderRadius = "10px"
            cardElement.style.background = theme.cardBackground
            cardElement.style.border = `1px solid ${theme.cardBorder}`
            cardElement.style.color = theme.text
            cardElement.style.boxShadow = `0 0 12px ${theme.primaryGlow}`
            cardElement.style.transition = "box-shadow 0.35s ease, opacity 1s ease"
            cardElement.style.opacity = "0"

            cardElement.addEventListener("mouseenter", () => {
                cardElement.style.boxShadow = `0 0 16px ${theme.primaryGlow}, 0 0 28px ${theme.primaryGlow}`
            })

            cardElement.addEventListener("mouseleave", () => {
                cardElement.style.boxShadow = `0 0 12px ${theme.primaryGlow}`
            })

            const contentElement = document.createElement("div")
            contentElement.innerText = `"${responseData.content || ""}"`
            contentElement.style.marginBottom = "8px"

            const urlElement = document.createElement("a")
            urlElement.href = responseData.url || "#"
            urlElement.innerText = `${responseData.url || ""} (${Math.floor((responseData.score || 0) * 100)}%)`
            urlElement.style.fontSize = "12px"
            urlElement.style.color = theme.primary
            urlElement.style.textDecoration = "none"
            urlElement.style.wordBreak = "break-word"
            urlElement.style.marginBottom = "10px"
            urlElement.target = "_blank"
            urlElement.rel = "noopener noreferrer"

            let navigationButton = null
            if (responseData.accessible) {
                const buttonElement = document.createElement("button")
                buttonElement.innerText = "Take me there"
                buttonElement.style.padding = "6px 8px"
                buttonElement.style.margin = "5px 0"
                buttonElement.style.borderRadius = "8px"
                buttonElement.style.border = "none"
                buttonElement.style.cursor = "pointer"
                buttonElement.style.background = theme.primary
                buttonElement.style.color = theme.text
                buttonElement.style.fontWeight = "bold"
                buttonElement.style.boxShadow = `0 0 10px ${theme.primaryGlow}`
                buttonElement.style.transition = "all 0.25s ease"
                buttonElement.style.position = "relative"
                buttonElement.style.webkitTextStroke = `1px ${theme.cardBorder}`
                buttonElement.style.textStroke = `1px ${theme.cardBorder}`
                buttonElement.style.webkitTextFillColor = theme.text
                buttonElement.style.textFillColor = theme.text
                buttonElement.id = "siteGuideNavigateButton"
                buttonElement.style.display = "inline-block"

                buttonElement.addEventListener("mouseenter", () => {
                    buttonElement.style.boxShadow = `0 0 14px ${theme.primaryGlow}, 0 0 28px ${theme.primaryGlow}`
                })

                buttonElement.addEventListener("mouseleave", () => {
                    buttonElement.style.boxShadow = `0 0 10px ${theme.primaryGlow}`
                })

                buttonElement.addEventListener("mousedown", () => {
                    buttonElement.style.boxShadow = `0 0 6px ${theme.primaryGlow}`
                })

                buttonElement.addEventListener("mouseup", () => {
                    buttonElement.style.boxShadow = `0 0 14px ${theme.primaryGlow}, 0 0 28px ${theme.primaryGlow}`
                })

                const anchorObject = { text: responseData.content }
                saveAnchorData(anchorObject, days = 1)

                buttonElement.addEventListener("click", function () {
                    const anchorObject = { text: responseData.content }
                    saveAnchorData(anchorObject, days = 1)

                    if (responseData.url == window.location.href) {
                        const anchorData = loadAnchorData()

                        if (anchorData && anchorData.text) {
                            findAndScroll(anchorData)
                            return
                        }
                        return
                    }

                    window.location.href = responseData.url
                })

                navigationButton = buttonElement
            }

            cardElement.appendChild(contentElement)
            cardElement.appendChild(urlElement)
            if (navigationButton) cardElement.appendChild(navigationButton)

            resultContainer.appendChild(cardElement)

            requestAnimationFrame(() => {
                cardElement.style.opacity = "1"
                skeletonCards.forEach((skeleton) => {
                    const rectangle = skeleton.getBoundingClientRect()
                    skeleton.style.position = "absolute"
                    skeleton.style.left = rectangle.left + "px"
                    skeleton.style.top = rectangle.top + "px"
                    skeleton.style.width = rectangle.width + "px"
                    skeleton.style.height = rectangle.height + "px"
                    skeleton.style.transition = "opacity 0.5s ease"
                    skeleton.style.opacity = "0"
                    document.body.appendChild(skeleton)
                    
                    setTimeout(() => {
                        skeleton.remove()
                    }, 500)
                })
            })
        } catch (error) {
            resultContainer.innerHTML = ""
            const errorElement = document.createElement("div")
            errorElement.innerText = "Error fetching results"
            errorElement.style.color = "red"
            resultContainer.appendChild(errorElement)
        }
    }

    inputElement.addEventListener("keydown", async function (event) {
        if (event.key === "Enter" || event.key === "Go" || event.key === "Search" || event.key === "Done") {
            event.preventDefault()
            triggerSearch()
        }
    })

    inputElement.addEventListener("keyup", function (event) {
        if (event.key === "Enter") {
            event.preventDefault()
            triggerSearch()
        }
    })
})()