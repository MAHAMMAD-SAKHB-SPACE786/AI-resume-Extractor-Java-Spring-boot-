package com.resumeai.resumeanalyzer;

import java.util.List;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;

@Controller
public class ResumeController {

    private final ResumeParser resumeParser;
    private final SkillExtractor skillExtractor;
    private final RoleKnowledgeBase roleKb;
    private final ResumeScorer scorer;
    private final SemanticMatcher semanticMatcher;
    private final RoadmapGenerator roadmapGenerator;
    private final ResumeCoach resumeCoach;

    public ResumeController(ResumeParser resumeParser,
                            SkillExtractor skillExtractor,
                            RoleKnowledgeBase roleKb,
                            ResumeScorer scorer,
                            SemanticMatcher semanticMatcher,
                            RoadmapGenerator roadmapGenerator,
                            ResumeCoach coach) {
        this.resumeParser = resumeParser;
        this.skillExtractor = skillExtractor;
        this.roleKb = roleKb;
        this.scorer = scorer;
        this.semanticMatcher = semanticMatcher;
        this.roadmapGenerator = roadmapGenerator;
        this.resumeCoach = coach;
    }

    @GetMapping("/")
    public String home(Model model) {
        model.addAttribute("roles", roleKb.roleInfos());
        return "index";
    }

    // HTMX sends the header HX-Request, so we answer with only the results part of the page
    @PostMapping("/analyze")
    public String analyze(@RequestParam("resume") MultipartFile file,
                          @RequestParam("role") String role,
                          @RequestHeader(value = "HX-Request", required = false) String htmx,
                          Model model) {

        String view = htmx != null ? "index :: results" : "index";
        model.addAttribute("roles", roleKb.roleInfos());
        model.addAttribute("selectedRole", role);

        if (roleKb.role(role) == null) {
            model.addAttribute("error", "Please choose one of the target roles.");
            return view;
        }
        if (file.isEmpty() || !"application/pdf".equals(file.getContentType())) {
            model.addAttribute("error", "Please upload a PDF file.");
            return view;
        }

        try (PDDocument document = Loader.loadPDF(file.getBytes())) {
            String text = new PDFTextStripper().getText(document);
            int pages = document.getNumberOfPages();

            // 1. Structure the resume with rules
            ResumeParser.ParsedResume resume = resumeParser.parse(text, pages);

            // 2. Skills: written by the candidate + found by the local AI
            SkillExtractor.Extracted extracted = skillExtractor.extract(resume, text);

            // 3. Compare with the role (evidence levels and weighted score)
            ResumeScorer.Analysis analysis = scorer.analyze(role, resume, text, extracted.aiFound());

            // 4. Semantic hints: missing skills that are close to skills you already have
            List<String> missingNames = analysis.skills().stream()
                    .filter(s -> s.status().equals("missing")).map(ResumeScorer.SkillResult::name).toList();
            analysis = analysis.withRelated(semanticMatcher.relatedSkills(missingNames, extracted.all()));

            // 5. Roadmap (RAG plus a short AI summary)
            RoadmapGenerator.Roadmap roadmap = roadmapGenerator.generate(role, analysis);

            // 6. Weak bullet points for the AI coach tab
            List<String> weak = ResumeParser.weakBullets(resume, 3);

            model.addAttribute("fileName", file.getOriginalFilename());
            model.addAttribute("resume", resume);
            model.addAttribute("extracted", extracted);
            model.addAttribute("analysis", analysis);
            model.addAttribute("roadmap", roadmap);
            model.addAttribute("weakBullets", weak);
            model.addAttribute("weakBulletsText", String.join("\n", weak));
            // Private-use bullet symbols show as empty boxes, so swap them for a normal bullet
            model.addAttribute("text", text.replaceAll("[\\uE000-\\uF8FF]", "\u2022"));
        } catch (Exception e) {
            model.addAttribute("error", "Could not process this PDF: " + e.getMessage());
        }
        return view;
    }

    // Called by HTMX when the user clicks "Improve these bullet points". Nothing is stored.
    @PostMapping("/coach")
    public String coach(@RequestParam("bullets") String bullets,
                        @RequestParam(value = "role", required = false) String role,
                        Model model) {
        String roleName = roleKb.role(role) != null ? role : "your target";
        List<String> list = List.of(bullets.split("\\R"));
        try {
            model.addAttribute("suggestions", resumeCoach.improve(roleName, list));
        } catch (Exception e) {
            model.addAttribute("suggestions", List.of());
            model.addAttribute("coachError", "The AI coach could not answer: " + e.getMessage());
        }
        return "index :: coach";
    }
}